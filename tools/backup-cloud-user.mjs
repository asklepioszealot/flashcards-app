import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function printHelp() {
  console.log(`flashcards-app cloud user backup

Bu komut, normal uygulama hesabinla giris yapip kendi bulut verini JSON olarak disa aktarir.
DB sifresi veya Docker gerekmez.

Kullanim:
  node ./tools/backup-cloud-user.mjs
  node ./tools/backup-cloud-user.mjs --email kullanici@example.com

Opsiyonlar:
  --email <mail>      Giris e-postasi
  --password <sifre>  Giris sifresi
  --output <klasor>   Cikti klasoru
  --help              Bu yardimi goster

Ortam degiskenleri:
  FLASHCARDS_EMAIL
  FLASHCARDS_PASSWORD
  SUPABASE_URL
  SUPABASE_ANON_KEY
`);
}

function parseArgs(argv) {
  const args = {
    email: process.env.FLASHCARDS_EMAIL || "",
    password: process.env.FLASHCARDS_PASSWORD || "",
    outputRoot: path.join(repoRoot, "backups", "cloud-user"),
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--email") {
      args.email = argv[i + 1] || "";
      i += 1;
    } else if (token === "--password") {
      args.password = argv[i + 1] || "";
      i += 1;
    } else if (token === "--output") {
      args.outputRoot = argv[i + 1] || args.outputRoot;
      i += 1;
    } else {
      throw new Error(`Bilinmeyen arguman: ${token}`);
    }
  }

  return args;
}

function loadRuntimeConfig() {
  const runtimeConfigPath = path.join(repoRoot, "runtime-config.local.json");
  let fileConfig = {};

  if (fs.existsSync(runtimeConfigPath)) {
    fileConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
  }

  const supabaseUrl = process.env.SUPABASE_URL || fileConfig.supabaseUrl || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || fileConfig.supabaseAnonKey || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase URL / anon key bulunamadi. runtime-config.local.json veya ortam degiskenleri gerekli.");
  }

  return { supabaseUrl, supabaseAnonKey };
}

async function promptForMissingCredentials(args) {
  const rl = readline.createInterface({ input, output });
  try {
    if (!args.email) {
      args.email = (await rl.question("Uygulama e-postasi: ")).trim();
    }
    if (!args.password) {
      args.password = (await rl.question("Uygulama sifresi: ")).trim();
    }
  } finally {
    rl.close();
  }

  if (!args.email || !args.password) {
    throw new Error("E-posta ve sifre gerekli.");
  }
}

function timestampNow() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function sanitizeFileSegment(value, fallback = "set") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function isStudyStateFallbackRow(row) {
  return (
    String(row?.slug || "") === "__system-study-state__" ||
    String(row?.set_name || "") === "__system_study_state__" ||
    String(row?.id || "").includes("::system::study-state::")
  );
}

function isMissingRelationError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

function rowToImportableJson(row) {
  return {
    id: row.id,
    slug: row.slug,
    setName: row.set_name,
    fileName: row.file_name,
    cards: Array.isArray(row.cards_json) ? row.cards_json : [],
  };
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const { supabaseUrl, supabaseAnonKey } = loadRuntimeConfig();
  await promptForMissingCredentials(args);

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const signInResult = await client.auth.signInWithPassword({
    email: args.email.trim().toLowerCase(),
    password: args.password,
  });

  if (signInResult.error) {
    throw new Error(`Giris basarisiz: ${signInResult.error.message}`);
  }

  const user = signInResult.data.user;
  if (!user) {
    throw new Error("Giris basarili gorundu ama kullanici bilgisi donmedi.");
  }

  const setResult = await client
    .from("flashcard_sets")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (setResult.error) {
    throw new Error(`flashcard_sets okunamadi: ${setResult.error.message}`);
  }

  const sets = setResult.data || [];

  const stateResult = await client
    .from("flashcard_user_state")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  let stateRow = null;
  let stateTableAvailable = true;
  if (stateResult.error) {
    if (isMissingRelationError(stateResult.error)) {
      stateTableAvailable = false;
    } else if (stateResult.error.code !== "PGRST116") {
      throw new Error(`flashcard_user_state okunamadi: ${stateResult.error.message}`);
    }
  } else {
    stateRow = stateResult.data || null;
  }

  const backupDir = path.resolve(args.outputRoot, timestampNow());
  const setsDir = path.join(backupDir, "sets");
  fs.mkdirSync(setsDir, { recursive: true });

  const visibleSets = sets.filter((row) => !isStudyStateFallbackRow(row));
  visibleSets.forEach((row, index) => {
    const baseName = sanitizeFileSegment(
      row.file_name || row.slug || row.set_name || `set-${index + 1}`,
      `set-${index + 1}`,
    );
    const filePath = path.join(setsDir, `${baseName}.json`);
    writeJsonFile(filePath, rowToImportableJson(row));
  });

  const backupPayload = {
    exportedAt: new Date().toISOString(),
    source: {
      supabaseUrl,
      projectRef: new URL(supabaseUrl).hostname.split(".")[0],
    },
    user: {
      id: user.id,
      email: user.email,
    },
    summary: {
      visibleSetCount: visibleSets.length,
      totalFlashcardSetRows: sets.length,
      stateTableAvailable,
      hasDedicatedStateRow: Boolean(stateRow),
      hasFallbackStateRow: sets.some((row) => isStudyStateFallbackRow(row)),
    },
    flashcardSets: sets,
    flashcardUserState: stateRow,
  };

  writeJsonFile(path.join(backupDir, "backup.json"), backupPayload);
  fs.writeFileSync(
    path.join(backupDir, "README.txt"),
    [
      "Bu klasor flashcards-app kullanici bulut yedegidir.",
      `Kullanici: ${user.email || user.id}`,
      `Disa aktarma zamani: ${backupPayload.exportedAt}`,
      `Gorunur set sayisi: ${visibleSets.length}`,
      "",
      "Dosyalar:",
      "- backup.json: ham Supabase satirlari + ozet",
      "- sets/*.json: uygulamaya yeniden yuklenebilecek set dosyalari",
      "",
      "Not: Bu yedek yalnizca kendi kullanici verinizi kapsar.",
    ].join("\n"),
    "utf8",
  );

  await client.auth.signOut();

  console.log(`Yedek olusturuldu: ${backupDir}`);
  console.log(`Set dosyalari: ${visibleSets.length}`);
  if (!stateTableAvailable) {
    console.log("Not: flashcard_user_state tablosu bulunamadi; state verisi gizli sistem kaydi icinde olabilir.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
