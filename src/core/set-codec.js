const CRITICAL_PATTERN = /==([^=]+)==/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;
const STRIKE_PATTERN = /~~([^~]+)~~/g;
const ITALIC_PATTERN = /(^|[^*])\*([^*\n]+)\*(?!\*)/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

export function generateId(prefix = "id") {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80) || generateId("set");
}

function renderInlineMarkdown(text) {
  let escaped = escapeHtml(text ?? "");
  const codeTokens = [];

  escaped = escaped.replace(INLINE_CODE_PATTERN, (_, codeText) => {
    const token = `__CODE_TOKEN_${codeTokens.length}__`;
    codeTokens.push(`<code>${codeText}</code>`);
    return token;
  });

  escaped = escaped
    .replace(LINK_PATTERN, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
    .replace(CRITICAL_PATTERN, "<strong class=\"highlight-critical\">$1</strong>")
    .replace(BOLD_PATTERN, "<strong>$1</strong>")
    .replace(STRIKE_PATTERN, "<del>$1</del>")
    .replace(ITALIC_PATTERN, "$1<em>$2</em>");

  codeTokens.forEach((tokenHtml, index) => {
    escaped = escaped.replace(`__CODE_TOKEN_${index}__`, tokenHtml);
  });

  return escaped;
}

function parseTableCells(line) {
  return String(line ?? "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(String(line ?? ""));
}

function renderTableBlock(lines) {
  const headerCells = parseTableCells(lines[0]);
  const bodyRows = lines
    .slice(2)
    .map(parseTableCells)
    .filter((row) => row.some((cell) => cell.length > 0));

  const headerHtml = headerCells.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("");
  const bodyHtml = bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderMarkdownBlock(block) {
  const lines = String(block ?? "")
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return "";

  if (lines.length >= 2 && lines[0].includes("|") && isMarkdownTableSeparator(lines[1])) {
    return renderTableBlock(lines);
  }

  if (lines.length === 1) {
    const line = lines[0].trim();
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6);
      return `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`;
    }

    if (/^[-*_]{3,}$/.test(line.replace(/\s+/g, ""))) {
      return "<hr />";
    }
  }

  if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
    const items = lines
      .map((line) => line.replace(/^\s*[-*+]\s+/, ""))
      .map((line) => `<li>${renderInlineMarkdown(line)}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    const items = lines
      .map((line) => line.replace(/^\s*\d+\.\s+/, ""))
      .map((line) => `<li>${renderInlineMarkdown(line)}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  }

  if (lines.every((line) => /^\s*>\s?/.test(line))) {
    const quoteLines = lines.map((line) => line.replace(/^\s*>\s?/, ""));
    const quoteClass = quoteLines.every((line) => line.trim().startsWith("⚠️"))
      ? ' class="markdown-callout warning"'
      : "";
    return `<blockquote${quoteClass}>${quoteLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</blockquote>`;
  }

  return `<p>${lines.map((line) => renderInlineMarkdown(line.trim())).join("<br>")}</p>`;
}

export function renderAnswerMarkdown(markdownText) {
  const normalizedText = String(markdownText ?? "").trim() || "Açıklama bulunamadı.";
  return normalizedText
    .split(/\n{2,}/)
    .map((block) => renderMarkdownBlock(block))
    .join("");
}

function fallbackHtmlToEditableMarkdown(htmlText) {
  return String(htmlText ?? "")
    .trim()
    .replace(
      /<strong\s+class=['"]highlight-critical['"]>(.*?)<\/strong>/gi,
      "==$1==",
    )
    .replace(
      /<span\s+class=['"]highlight-important['"]>\s*⚠️(.*?)<\/span>/gi,
      "> ⚠️$1",
    )
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeEditableMarkdown(markdownText) {
  return String(markdownText ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringifyInlineNodes(nodes) {
  return Array.from(nodes)
    .map((node) => inlineNodeToMarkdown(node))
    .join("")
    .replace(/\u00a0/g, " ");
}

function inlineNodeToMarkdown(node) {
  if (!node) return "";
  if (node.nodeType === 3) {
    return node.textContent || "";
  }
  if (node.nodeType !== 1) return "";

  const tagName = node.tagName.toLowerCase();
  if (tagName === "br") return "\n";
  if (tagName === "strong" && node.classList.contains("highlight-critical")) {
    return `==${stringifyInlineNodes(node.childNodes)}==`;
  }
  if (tagName === "strong") return `**${stringifyInlineNodes(node.childNodes)}**`;
  if (tagName === "em") return `*${stringifyInlineNodes(node.childNodes)}*`;
  if (tagName === "del") return `~~${stringifyInlineNodes(node.childNodes)}~~`;
  if (tagName === "code") return `\`${node.textContent || ""}\``;
  if (tagName === "a") {
    const href = node.getAttribute("href") || "";
    return `[${stringifyInlineNodes(node.childNodes)}](${href})`;
  }
  return stringifyInlineNodes(node.childNodes);
}

function stringifyParagraph(node) {
  return stringifyInlineNodes(node.childNodes)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringifyTable(tableNode) {
  const rows = Array.from(tableNode.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.children).map((cell) =>
        stringifyParagraph(cell).replace(/\n+/g, " ").trim(),
      ),
    )
    .filter((row) => row.some((cell) => cell.length > 0));

  if (!rows.length) return "";

  const headerRow = rows[0];
  const separatorRow = headerRow.map(() => "---");
  const bodyRows = rows.slice(1);

  return [
    `| ${headerRow.join(" | ")} |`,
    `| ${separatorRow.join(" | ")} |`,
    ...bodyRows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function stringifyBlockNode(node) {
  if (!node) return "";
  if (node.nodeType === 3) {
    const text = String(node.textContent || "").trim();
    return text;
  }
  if (node.nodeType !== 1) return "";

  const tagName = node.tagName.toLowerCase();
  if (tagName === "div" && node.classList.contains("markdown-table-wrap")) {
    const tableNode = node.querySelector("table");
    return tableNode ? stringifyTable(tableNode) : "";
  }
  if (tagName === "table") return stringifyTable(node);
  if (/^h[1-6]$/.test(tagName)) {
    return `${"#".repeat(Number.parseInt(tagName.slice(1), 10))} ${stringifyParagraph(node)}`.trim();
  }
  if (tagName === "hr") return "---";
  if (tagName === "p") return stringifyParagraph(node);
  if (tagName === "blockquote") {
    const content = stringifyBlockChildren(node.childNodes);
    if (!content) return "";
    return content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (tagName === "ul") {
    return Array.from(node.children)
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((item) => `- ${stringifyParagraph(item)}`)
      .join("\n");
  }
  if (tagName === "ol") {
    return Array.from(node.children)
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((item, index) => `${index + 1}. ${stringifyParagraph(item)}`)
      .join("\n");
  }
  return stringifyBlockChildren(node.childNodes);
}

function stringifyBlockChildren(nodes) {
  return Array.from(nodes)
    .map((node) => stringifyBlockNode(node))
    .filter(Boolean)
    .join("\n\n");
}

export function htmlToEditableMarkdown(htmlText) {
  const raw = String(htmlText ?? "").trim();
  if (!raw) return "";
  if (typeof DOMParser !== "function") {
    return fallbackHtmlToEditableMarkdown(raw);
  }

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(`<div>${raw}</div>`, "text/html");
    const root = documentNode.body.firstElementChild;
    if (!root) {
      return fallbackHtmlToEditableMarkdown(raw);
    }
    const markdown = normalizeEditableMarkdown(stringifyBlockChildren(root.childNodes));
    return markdown || fallbackHtmlToEditableMarkdown(raw);
  } catch {
    return fallbackHtmlToEditableMarkdown(raw);
  }
}

function normalizeCardShape(card, index, previousCards = []) {
  const previousCard = previousCards[index];
  const cardId =
    typeof card?.id === "string" && card.id.trim()
      ? card.id.trim()
      : previousCard?.id || generateId("card");

  const questionText = String(card?.q ?? "").trim();
  const answerHtml =
    typeof card?.a === "string" && card.a.trim()
      ? card.a
      : renderAnswerMarkdown(stripTags(card?.a ?? ""));

  return {
    id: cardId,
    q: questionText,
    a: answerHtml,
    subject: String(card?.subject ?? previousCard?.subject ?? "Genel").trim() || "Genel",
  };
}

function parseMcqQuestions(questionList) {
  return questionList.map((question) => {
    const options = Array.isArray(question.options) ? question.options : [];
    const correctIndex = Number.isInteger(question.correct) ? question.correct : -1;
    const correctLine =
      correctIndex >= 0 && correctIndex < options.length
        ? `**Doğru Cevap: ${String.fromCharCode(65 + correctIndex)}) ${options[correctIndex]}**`
        : "";
    const explanation = String(question.explanation ?? "").trim();
    const answerText = [correctLine, explanation].filter(Boolean).join("\n\n");
    return {
      id: typeof question.id === "string" ? question.id : generateId("card"),
      q: String(question.q ?? "").trim(),
      a: renderAnswerMarkdown(answerText),
      subject: String(question.subject ?? "Genel").trim() || "Genel",
    };
  });
}

export function parseMarkdownSet(content, fileName = "set.md", previousRecord = null) {
  const lines = String(content ?? "").split(/\r?\n/);
  const fileStem = String(fileName || "set").replace(/\.[^/.]+$/, "");
  const previousCards = Array.isArray(previousRecord?.cards) ? previousRecord.cards : [];

  let setName = previousRecord?.setName || fileStem;
  let canonicalSubject = previousRecord?.setName || fileStem;
  const cards = [];

  let currentCard = null;
  let freeAnswerLines = [];
  let explanationLines = [];
  let awaitingQuestionText = false;
  let collectingExplanation = false;

  function finalizeCurrentCard() {
    if (!currentCard) return;

    const freeAnswer = freeAnswerLines.join("\n").trim();
    const explanation = explanationLines.join("\n").trim();

    let answerRaw = "";
    if (currentCard.correctChar || currentCard.options.length > 0 || explanation) {
      const parts = [];
      if (currentCard.correctChar) {
        const optionIndex = currentCard.correctChar.charCodeAt(0) - 65;
        const optionText =
          optionIndex >= 0 && optionIndex < currentCard.options.length
            ? currentCard.options[optionIndex]
            : "";
        parts.push(
          optionText
            ? `**Doğru Cevap: ${currentCard.correctChar}) ${optionText}**`
            : `**Doğru Cevap: ${currentCard.correctChar}**`,
        );
      }
      if (explanation) {
        parts.push(explanation);
      }
      answerRaw = parts.join("\n\n").trim() || freeAnswer;
    } else {
      answerRaw = freeAnswer;
    }

    const cardIndex = cards.length;
    const previousCard = previousCards[cardIndex];
    cards.push(
      normalizeCardShape(
        {
          id: currentCard.id || previousCard?.id,
          q: currentCard.q,
          a: renderAnswerMarkdown(answerRaw),
          subject: currentCard.subject || canonicalSubject,
        },
        cardIndex,
        previousCards,
      ),
    );

    currentCard = null;
    freeAnswerLines = [];
    explanationLines = [];
    awaitingQuestionText = false;
    collectingExplanation = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const normalized = trimmed.replace(/^\*\*(.*?)\*\*$/, "$1").trim();

    if (/^[-*_]{3,}$/.test(trimmed)) continue;

    const h1Match = normalized.match(/^#\s+(.+)$/);
    if (h1Match) {
      const title = h1Match[1].trim();
      if (title) {
        setName = title;
        canonicalSubject = title;
      }
      continue;
    }

    const h2Match = normalized.match(/^##\s+(.+)$/);
    if (h2Match) {
      finalizeCurrentCard();
      canonicalSubject = h2Match[1].trim() || canonicalSubject;
      continue;
    }

    const h3Match = normalized.match(/^###\s+(.+)$/);
    const soruInlineMatch = normalized.match(/^Soru:\s*(.+)$/i);
    const soruNumberedMatch = normalized.match(/^Soru\s+\d+[.)]?\s*(?::\s*(.*))?$/i);
    if (h3Match || soruInlineMatch || soruNumberedMatch) {
      finalizeCurrentCard();
      const qText = (
        h3Match ? h3Match[1] : soruInlineMatch ? soruInlineMatch[1] : soruNumberedMatch[1] || ""
      ).trim();
      currentCard = {
        id: previousCards[cards.length]?.id || generateId("card"),
        q: qText,
        subject: canonicalSubject,
        options: [],
        correctChar: "",
      };
      awaitingQuestionText = qText.length === 0;
      continue;
    }

    if (awaitingQuestionText && currentCard && normalized) {
      currentCard.q = normalized;
      awaitingQuestionText = false;
      continue;
    }

    const konuMatch = normalized.match(/^#{0,3}\s*Konu:\s*(.+)$/i);
    if (konuMatch && currentCard) {
      currentCard.subject = konuMatch[1].trim() || currentCard.subject;
      continue;
    }

    const optionMatch = normalized.match(/^([A-Ea-e])[).]\s+(.+)$/);
    if (optionMatch && currentCard && !collectingExplanation) {
      currentCard.options.push(optionMatch[2].trim());
      continue;
    }

    const correctMatch = normalized.match(/^Do(?:ğ|g)ru\s*Cevap:\s*([A-Ea-e])\b/i);
    if (correctMatch && currentCard) {
      currentCard.correctChar = correctMatch[1].toUpperCase();
      continue;
    }

    const explanationStartMatch = normalized.match(/^(?:Açıklama|Aciklama):\s*(.*)$/i);
    if (explanationStartMatch && currentCard) {
      collectingExplanation = true;
      explanationLines.push(explanationStartMatch[1]);
      continue;
    }

    const blockquoteMatch = line.match(/^>\s?(.*)$/);
    if (
      blockquoteMatch &&
      currentCard &&
      (currentCard.correctChar || currentCard.options.length > 0 || collectingExplanation)
    ) {
      collectingExplanation = true;
      explanationLines.push(`> ${blockquoteMatch[1]}`);
      continue;
    }

    if (!currentCard) continue;
    if (collectingExplanation) {
      explanationLines.push(line);
    } else {
      freeAnswerLines.push(line);
    }
  }

  finalizeCurrentCard();

  return {
    setName: setName || fileStem,
    cards,
  };
}

function parseJsonSet(content, fileName, previousRecord = null) {
  const previousCards = Array.isArray(previousRecord?.cards) ? previousRecord.cards : [];
  const cleanText = String(content ?? "").replace(/,\s*([\]}])/g, "$1");
  const parsed = JSON.parse(cleanText);

  if (Array.isArray(parsed)) {
    return {
      setName: previousRecord?.setName || fileName.replace(/\.[^/.]+$/, ""),
      cards: parsed.map((card, index) => normalizeCardShape(card, index, previousCards)),
    };
  }

  if (Array.isArray(parsed.questions)) {
    return {
      setName: String(parsed.setName ?? previousRecord?.setName ?? fileName.replace(/\.[^/.]+$/, "")).trim(),
      cards: parseMcqQuestions(parsed.questions).map((card, index) =>
        normalizeCardShape(card, index, previousCards),
      ),
    };
  }

  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  return {
    setName: String(parsed.setName ?? previousRecord?.setName ?? fileName.replace(/\.[^/.]+$/, "")).trim(),
    cards: cards.map((card, index) => normalizeCardShape(card, index, previousCards)),
  };
}

function assignStableCardIds(cards, previousCards) {
  const usedIds = new Set();
  return cards.map((card, index) => {
    let nextId = typeof card.id === "string" && card.id.trim() ? card.id.trim() : "";
    if (!nextId && previousCards[index] && !usedIds.has(previousCards[index].id)) {
      nextId = previousCards[index].id;
    }
    if (!nextId) {
      const matched = previousCards.find((previousCard) => {
        return (
          !usedIds.has(previousCard.id) &&
          previousCard.q === card.q &&
          previousCard.subject === card.subject
        );
      });
      if (matched) {
        nextId = matched.id;
      }
    }
    if (!nextId || usedIds.has(nextId)) {
      nextId = generateId("card");
    }
    usedIds.add(nextId);
    return {
      ...card,
      id: nextId,
    };
  });
}

export function normalizeSetRecord(record, options = {}) {
  const previousRecord = options.previousRecord || null;
  const previousCards = Array.isArray(previousRecord?.cards) ? previousRecord.cards : [];
  const setId =
    typeof record?.id === "string" && record.id.trim()
      ? record.id.trim()
      : previousRecord?.id || generateId("set");

  const setName =
    String(record?.setName ?? previousRecord?.setName ?? "Yeni Set").trim() || "Yeni Set";
  const sourceFormat =
    record?.sourceFormat === "markdown" || record?.sourceFormat === "json"
      ? record.sourceFormat
      : previousRecord?.sourceFormat || "json";
  const fileName =
    String(
      record?.fileName ??
        previousRecord?.fileName ??
        `${slugify(setName)}.${sourceFormat === "markdown" ? "md" : "json"}`,
    ).trim() || `${slugify(setName)}.${sourceFormat === "markdown" ? "md" : "json"}`;

  const baseCards = Array.isArray(record?.cards) ? record.cards : [];
  const cards = assignStableCardIds(
    baseCards.map((card, index) => normalizeCardShape(card, index, previousCards)),
    previousCards,
  );

  return {
    id: setId,
    slug: String(record?.slug ?? previousRecord?.slug ?? slugify(setName)).trim() || slugify(setName),
    setName,
    fileName,
    sourceFormat,
    sourcePath: String(record?.sourcePath ?? previousRecord?.sourcePath ?? "").trim(),
    rawSource: String(record?.rawSource ?? previousRecord?.rawSource ?? "").trim(),
    cards,
    updatedAt: String(record?.updatedAt ?? new Date().toISOString()),
  };
}

export function serializeSetToMarkdown(setRecord, editableCards = null) {
  const cards = Array.isArray(editableCards) ? editableCards : buildEditorDraft(setRecord).cards;
  const lines = [`# ${setRecord.setName}`, ""];

  cards.forEach((card, index) => {
    lines.push(`### ${card.question || `Soru ${index + 1}`}`);
    if (card.subject) {
      lines.push(`Konu: ${card.subject}`);
    }
    lines.push("");
    lines.push(card.explanationMarkdown || "Açıklama bulunamadı.");
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function serializeSetToJson(setRecord, editableCards = null) {
  const cards = Array.isArray(editableCards)
    ? editableCards.map((card) => ({
        id: card.id,
        q: String(card.question ?? "").trim(),
        a: renderAnswerMarkdown(card.explanationMarkdown),
        subject: String(card.subject ?? "Genel").trim() || "Genel",
      }))
    : setRecord.cards;

  return JSON.stringify(
    {
      id: setRecord.id,
      slug: setRecord.slug,
      setName: setRecord.setName,
      fileName: setRecord.fileName,
      cards,
    },
    null,
    2,
  );
}

export function parseSetText(text, fileName, existingRecord = null, sourceFormatOverride = null) {
  const sourceFormat =
    sourceFormatOverride ||
    (/\.(md|txt)$/i.test(fileName || "") ? "markdown" : "json");
  const parsed =
    sourceFormat === "markdown"
      ? parseMarkdownSet(text, fileName, existingRecord)
      : parseJsonSet(text, fileName, existingRecord);

  const normalized = normalizeSetRecord(
    {
      ...existingRecord,
      setName: parsed.setName,
      fileName:
        existingRecord?.fileName ||
        fileName ||
        `${slugify(parsed.setName)}.${sourceFormat === "markdown" ? "md" : "json"}`,
      sourceFormat,
      rawSource: String(text ?? "").trim(),
      cards: parsed.cards,
    },
    { previousRecord: existingRecord },
  );

  if (!normalized.rawSource) {
    normalized.rawSource =
      sourceFormat === "markdown"
        ? serializeSetToMarkdown(normalized)
        : serializeSetToJson(normalized);
  }

  return normalized;
}

export function buildEditorDraft(setRecord) {
  const normalized = normalizeSetRecord(setRecord, { previousRecord: setRecord });
  const cards = normalized.cards.map((card) => ({
    id: card.id,
    subject: card.subject,
    question: card.q,
    explanationMarkdown: htmlToEditableMarkdown(card.a),
  }));

  return {
    setId: normalized.id,
    setName: normalized.setName,
    sourceFormat: normalized.sourceFormat,
    rawSource:
      normalized.rawSource ||
      (normalized.sourceFormat === "markdown"
        ? serializeSetToMarkdown(normalized, cards)
        : serializeSetToJson(normalized, cards)),
    cards,
    dirty: false,
    viewMode: "form",
    formLayoutMode: "list",
    activeCardIndex: 0,
    expandedCardId: null,
    toolbarExpandedCardId: null,
    expandedPreviewCardId: null,
  };
}

export function buildSetFromEditorDraft(draft, existingRecord) {
  const editableCards = Array.isArray(draft?.cards) ? draft.cards : [];
  const cards = editableCards.map((card) => ({
    id: card.id || generateId("card"),
    q: String(card.question ?? "").trim(),
    a: renderAnswerMarkdown(card.explanationMarkdown),
    subject: String(card.subject ?? "Genel").trim() || "Genel",
  }));

  const partial = normalizeSetRecord(
    {
      ...existingRecord,
      setName: draft.setName,
      sourceFormat: existingRecord?.sourceFormat || draft.sourceFormat || "json",
      cards,
    },
    { previousRecord: existingRecord },
  );

  partial.rawSource =
    partial.sourceFormat === "markdown"
      ? serializeSetToMarkdown(partial, editableCards)
      : serializeSetToJson(partial, editableCards);
  partial.updatedAt = new Date().toISOString();

  return partial;
}

export function backfillRawSource(setRecord) {
  if (setRecord.rawSource && setRecord.rawSource.trim()) {
    return setRecord.rawSource;
  }
  return setRecord.sourceFormat === "markdown"
    ? serializeSetToMarkdown(setRecord)
    : serializeSetToJson(setRecord);
}
