import { unzipSync } from "fflate";
import initSqlJs from "sql.js/dist/sql-wasm.js";

import {
  backfillRawSource,
  generateId,
  htmlToEditableMarkdown,
  normalizeSetRecord,
  slugify,
} from "../../core/set-codec.js";
import { sanitizeMarkdownHtml, sanitizeMediaSource } from "../../core/security.js";
import { resolveSqlWasmUrl } from "../../shared/sql-wasm.js";

const FIELD_SEPARATOR = "\u001f";

function fileStem(fileName) {
  return String(fileName || "anki-import").replace(/\.[^/.]+$/, "") || "anki-import";
}

function guessMimeType(fileName) {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  const mimeTypes = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    webm: "audio/webm",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
  };
  return mimeTypes[extension] || "application/octet-stream";
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function bytesToDataUri(bytes, fileName) {
  return `data:${guessMimeType(fileName)};base64,${bytesToBase64(bytes)}`;
}

function parseMediaManifest(entry) {
  if (!entry) return {};
  try {
    return JSON.parse(new TextDecoder().decode(entry));
  } catch {
    return {};
  }
}

function buildMediaLookup(zipEntries) {
  const manifest = parseMediaManifest(zipEntries.media);
  const lookup = new Map();

  Object.entries(manifest).forEach(([index, fileName]) => {
    const entry = zipEntries[index];
    if (!entry || typeof fileName !== "string" || !fileName.trim()) return;
    lookup.set(fileName, bytesToDataUri(entry, fileName));
  });

  return lookup;
}

function resolveAnkiMediaSource(source, mediaLookup, mediaType) {
  const trimmedSource = String(source || "").trim();
  if (!trimmedSource) return "";
  if (mediaLookup.has(trimmedSource)) {
    return mediaLookup.get(trimmedSource);
  }
  return sanitizeMediaSource(trimmedSource, mediaType);
}

function replaceSoundTokens(html, mediaLookup) {
  return String(html || "").replace(/\[sound:([^\]]+)\]/gi, (_, fileName) => {
    const safeSource = resolveAnkiMediaSource(fileName, mediaLookup, "audio");
    if (!safeSource) return "";
    return `<audio controls preload="metadata" src="${safeSource}" aria-label="${fileName}"></audio>`;
  });
}

function hydrateAnkiHtml(html, mediaLookup) {
  const withSound = replaceSoundTokens(html, mediaLookup);
  if (typeof DOMParser !== "function") {
    return sanitizeMarkdownHtml(withSound);
  }

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(`<div>${withSound}</div>`, "text/html");
    const root = documentNode.body.firstElementChild;
    if (!root) return sanitizeMarkdownHtml(withSound);

    root.querySelectorAll("img").forEach((image) => {
      const safeSource = resolveAnkiMediaSource(image.getAttribute("src"), mediaLookup, "image");
      if (!safeSource) {
        image.remove();
        return;
      }
      image.setAttribute("src", safeSource);
    });

    root.querySelectorAll("audio").forEach((audio) => {
      const safeSource = resolveAnkiMediaSource(audio.getAttribute("src"), mediaLookup, "audio");
      if (!safeSource) {
        audio.remove();
        return;
      }
      audio.setAttribute("src", safeSource);
      audio.setAttribute("controls", "");
      audio.setAttribute("preload", "metadata");
    });

    root.querySelectorAll("source").forEach((source) => {
      const safeSource = resolveAnkiMediaSource(source.getAttribute("src"), mediaLookup, "audio");
      if (!safeSource) {
        source.remove();
        return;
      }
      source.setAttribute("src", safeSource);
    });

    return sanitizeMarkdownHtml(root.innerHTML);
  } catch {
    return sanitizeMarkdownHtml(withSound);
  }
}

function parseDeckMap(database) {
  const result = database.exec("SELECT decks FROM col LIMIT 1");
  const decksJson = result?.[0]?.values?.[0]?.[0];
  if (!decksJson) return {};
  try {
    return JSON.parse(decksJson);
  } catch {
    return {};
  }
}

function pickSubject(deckName, tags) {
  const normalizedDeckName = String(deckName || "").trim();
  if (normalizedDeckName) {
    const parts = normalizedDeckName.split("::").filter(Boolean);
    return parts[parts.length - 1] || normalizedDeckName;
  }

  const tag = String(tags || "")
    .split(/\s+/)
    .map((value) => value.trim())
    .find(Boolean);

  return tag || "Genel";
}

export async function parseApkgToSetRecord(arrayBuffer, fileName, previousRecord = null) {
  const zipEntries = unzipSync(new Uint8Array(arrayBuffer));
  const collectionBytes = zipEntries["collection.anki2"] || zipEntries["collection.anki21"];
  if (!collectionBytes) {
    throw new Error("APKG içinde collection.anki2 veritabanı bulunamadı.");
  }

  const SQL = await initSqlJs({
    locateFile: () => resolveSqlWasmUrl(),
  });
  const database = new SQL.Database(collectionBytes);
  const mediaLookup = buildMediaLookup(zipEntries);
  const decks = parseDeckMap(database);

  const notesQuery = database.exec(`
    SELECT notes.id, notes.flds, notes.tags, MIN(cards.did) AS did
    FROM notes
    LEFT JOIN cards ON cards.nid = notes.id
    GROUP BY notes.id, notes.flds, notes.tags
    ORDER BY notes.id ASC
  `);

  const rows = notesQuery?.[0]?.values || [];
  const cards = rows
    .map((row, index) => {
      const [noteId, rawFields, rawTags, deckId] = row;
      const fields = String(rawFields || "").split(FIELD_SEPARATOR);
      const questionHtml = hydrateAnkiHtml(fields[0] || "", mediaLookup);
      const answerHtml = hydrateAnkiHtml(fields.slice(1).filter(Boolean).join("<hr />"), mediaLookup);
      const subject = pickSubject(decks?.[String(deckId)]?.name, rawTags);

      return {
        id: previousRecord?.cards?.[index]?.id || generateId("card"),
        q: htmlToEditableMarkdown(questionHtml) || `Kart ${index + 1}`,
        a: answerHtml || "<p>Cevap bulunamadı.</p>",
        subject,
        _noteId: noteId,
      };
    })
    .filter((card) => String(card.q || "").trim() || String(card.a || "").trim());

  database.close();

  if (!cards.length) {
    throw new Error("APKG içindeki kartlar okunamadı.");
  }

  const setName = previousRecord?.setName || fileStem(fileName);
  const normalized = normalizeSetRecord(
    {
      ...previousRecord,
      setName,
      fileName: `${slugify(setName)}.json`,
      sourceFormat: "json",
      rawSource: "",
      cards: cards.map(({ _noteId, ...card }) => card),
    },
    { previousRecord },
  );

  normalized.rawSource = backfillRawSource(normalized);
  return normalized;
}
