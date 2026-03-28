// src/features/editor/editor-toolbar.js
// Markdown formatting toolbar: snippet application, toolbar button rendering.

import { allMarkdownActions } from "../../shared/constants.js";
import { escapeMarkup } from "../../shared/utils.js";

export function applyMarkdownSnippet(textarea, action) {
  const { restoreEditorFieldSelection, rememberEditorFieldSelection } = require_editor_events();
  restoreEditorFieldSelection(textarea);
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const selectedText = textarea.value.slice(selectionStart, selectionEnd);
  let replacement = selectedText || "metin";
  let selectionOffsetStart = 0;
  let selectionOffsetEnd = replacement.length;

  if (action === "bold") {
    replacement = `**${selectedText || "kalın metin"}**`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length - 2;
  } else if (action === "italic") {
    replacement = `*${selectedText || "italik metin"}*`;
    selectionOffsetStart = 1;
    selectionOffsetEnd = replacement.length - 1;
  } else if (action === "critical") {
    replacement = `==${selectedText || "kritik bilgi"}==`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length - 2;
  } else if (action === "warning") {
    replacement = `> Dikkat: ${selectedText || "Dikkat edilmesi gereken nokta"}`;
    selectionOffsetStart = 11;
    selectionOffsetEnd = replacement.length;
  } else if (action === "quote") {
    replacement = `> ${selectedText || "Alıntı veya not"}`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length;
  } else if (action === "strike") {
    replacement = `~~${selectedText || "üstü çizili metin"}~~`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length - 2;
  } else if (action === "heading") {
    replacement = `## ${selectedText || "Başlık"}`;
    selectionOffsetStart = 3;
    selectionOffsetEnd = replacement.length;
  } else if (action === "bulletList") {
    const lines = (selectedText || "Liste maddesi").split("\n").map((line) => line.trim() || "Liste maddesi");
    replacement = lines.map((line) => `- ${line}`).join("\n");
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length;
  } else if (action === "numberList") {
    const lines = (selectedText || "Liste maddesi").split("\n").map((line) => line.trim() || "Liste maddesi");
    replacement = lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
    selectionOffsetStart = 3;
    selectionOffsetEnd = replacement.length;
  } else if (action === "link") {
    const label = selectedText || "bağlantı metni";
    replacement = `[${label}](https://example.com)`;
    selectionOffsetStart = replacement.indexOf("https://");
    selectionOffsetEnd = selectionOffsetStart + "https://example.com".length;
  } else if (action === "code") {
    const codeText = selectedText || "kod";
    if (codeText.includes("\n")) {
      replacement = `\`\`\`\n${codeText}\n\`\`\``;
      selectionOffsetStart = 4;
      selectionOffsetEnd = 4 + codeText.length;
    } else {
      replacement = `\`${codeText}\``;
      selectionOffsetStart = 1;
      selectionOffsetEnd = replacement.length - 1;
    }
  } else if (action === "divider") {
    replacement = "\n\n---\n\n";
    selectionOffsetStart = replacement.length;
    selectionOffsetEnd = replacement.length;
  } else if (action === "table") {
    replacement = "| Başlık | Değer |\n| --- | --- |\n| Satır | Açıklama |";
    selectionOffsetStart = replacement.indexOf("Başlık");
    selectionOffsetEnd = selectionOffsetStart + "Başlık".length;
  }

  textarea.setRangeText(replacement, selectionStart, selectionEnd, "end");
  textarea.focus();
  textarea.setSelectionRange(selectionStart + selectionOffsetStart, selectionStart + selectionOffsetEnd);
  rememberEditorFieldSelection(textarea);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function renderEditorToolbarButtons(actions, cardId) {
  const cardIdAttr = escapeMarkup(cardId);
  return actions
    .map(
      (action) =>
        `<button type="button" class="btn btn-small btn-secondary editor-tool-btn" data-md-action="${action.id}" data-card-id="${cardIdAttr}" title="${action.title}" aria-label="${action.title}">${action.label}</button>`,
    )
    .join("");
}

export function renderEditorFormattingToolbar(cardId) {
  return `
    <div class="editor-format-toolbar">
      <div class="editor-format-toolbar-head">
        <div class="editor-format-toolbar-label">
          <strong>Biçimlendirme</strong>
        </div>
      </div>
      <div class="editor-toolbar-shell" role="toolbar" aria-label="Soru ve açıklama biçimlendirme araçları">
        <div class="editor-toolbar editor-toolbar-primary">
          ${renderEditorToolbarButtons(allMarkdownActions, cardId)}
        </div>
      </div>
    </div>`;
}

// Lazy reference to break circular dep with editor-events.js
let _editorEventsModule = null;
function require_editor_events() {
  if (_editorEventsModule) return _editorEventsModule;
  throw new Error("editor-events module not yet initialized — call initEditorEventsRef first");
}
export function initEditorEventsRef(mod) { _editorEventsModule = mod; }
