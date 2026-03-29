// src/features/editor/editor-toolbar.js
// Markdown formatting toolbar: snippet application, toolbar button rendering.

import { platformAdapter } from "../../app/state.js";
import { FLASHCARD_MEDIA_ACCEPT, allMarkdownActions } from "../../shared/constants.js";
import { escapeMarkup } from "../../shared/utils.js";
import { renderIcon } from "../../ui/icons.js";

export function insertTextAtSelection(textarea, replacement, options = {}) {
  if (!textarea) return;

  const { restoreEditorFieldSelection, rememberEditorFieldSelection } = require_editor_events();
  restoreEditorFieldSelection(textarea);

  const selectionStart = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
  const selectionEnd = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : selectionStart;
  const nextSelectionStart = Number.isFinite(options.selectionStart)
    ? options.selectionStart
    : String(replacement ?? "").length;
  const nextSelectionEnd = Number.isFinite(options.selectionEnd)
    ? options.selectionEnd
    : nextSelectionStart;

  textarea.setRangeText(String(replacement ?? ""), selectionStart, selectionEnd, options.selectionMode || "end");
  textarea.focus();
  textarea.setSelectionRange(selectionStart + nextSelectionStart, selectionStart + nextSelectionEnd);
  rememberEditorFieldSelection(textarea);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function applyMarkdownSnippet(textarea, action) {
  const { restoreEditorFieldSelection } = require_editor_events();
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
  } else if (action === "attachment-image") {
    replacement = "![Açıklama](https://example.com/gorsel.png)";
    selectionOffsetStart = replacement.indexOf("https://");
    selectionOffsetEnd = replacement.length - 1;
  } else if (action === "attachment-audio") {
    replacement = '<audio controls src="https://example.com/ses.mp3"></audio>';
    selectionOffsetStart = replacement.indexOf("https://");
    selectionOffsetEnd = replacement.indexOf('"', selectionOffsetStart);
  }

  insertTextAtSelection(textarea, replacement, {
    selectionEnd: selectionOffsetEnd,
    selectionStart: selectionOffsetStart,
  });
}

export function renderEditorToolbarButtons(actions, cardId) {
  const cardIdAttr = escapeMarkup(cardId);
  return actions
    .map((action) => {
      const iconMarkup = action.icon ? renderIcon(action.icon) : "";
      if (action.id === "attachment") {
        const menuId = `editor-attachment-menu-${cardIdAttr}`;
        const mediaUploadEnabled = Boolean(platformAdapter?.supportsMediaUpload);
        const attachmentTitle = mediaUploadEnabled
          ? action.title
          : "Medya yuklemek icin Supabase Storage yapilandirmasi gerekli";
        return `
          <div class="editor-attachment-shell" data-editor-attachment-shell="${cardIdAttr}">
            <button
              type="button"
              class="btn btn-small btn-secondary editor-tool-btn editor-tool-btn--icon"
              data-editor-attachment-toggle="${cardIdAttr}"
              data-editor-attachment-enabled="${mediaUploadEnabled}"
              data-card-id="${cardIdAttr}"
              title="${attachmentTitle}"
              aria-label="${attachmentTitle}"
              aria-controls="${menuId}"
              aria-expanded="false"
            >${iconMarkup}</button>
            <input
              type="file"
              class="editor-attachment-input"
              data-editor-attachment-input="${cardIdAttr}"
              data-card-id="${cardIdAttr}"
              accept="${escapeMarkup(FLASHCARD_MEDIA_ACCEPT)}"
              hidden
            />
            <div class="editor-attachment-menu" id="${menuId}" hidden>
              <button
                type="button"
                class="btn btn-small btn-secondary editor-tool-btn"
                data-editor-attachment-kind="image"
                data-card-id="${cardIdAttr}"
                title="Gorsel yukle"
                aria-label="Gorsel yukle"
                ${mediaUploadEnabled ? "" : "disabled"}
              >Gorsel</button>
              <button
                type="button"
                class="btn btn-small btn-secondary editor-tool-btn"
                data-editor-attachment-kind="audio"
                data-card-id="${cardIdAttr}"
                title="Ses yukle"
                aria-label="Ses yukle"
                ${mediaUploadEnabled ? "" : "disabled"}
              >Ses</button>
            </div>
          </div>`;
      }

      return `
        <button
          type="button"
          class="btn btn-small btn-secondary editor-tool-btn ${action.iconOnly ? "editor-tool-btn--icon" : ""}"
          data-md-action="${action.id}"
          data-card-id="${cardIdAttr}"
          title="${action.title}"
          aria-label="${action.title}"
        >${action.iconOnly ? iconMarkup : `${iconMarkup}${action.label}`}</button>`;
    })
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
