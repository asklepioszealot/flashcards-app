import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  applyMarkdownSnippet,
  initEditorEventsRef,
  renderEditorToolbarButtons,
} from "../../src/features/editor/editor-toolbar.js";
import { primaryMarkdownActions } from "../../src/shared/constants.js";

describe("Editor toolbar attachment snippets", () => {
  let dom;
  let previousEvent;

  beforeEach(() => {
    dom = new JSDOM("<textarea></textarea>");
    previousEvent = global.Event;
    global.Event = dom.window.Event;
    initEditorEventsRef({
      restoreEditorFieldSelection: () => {},
      rememberEditorFieldSelection: () => {},
    });
  });

  afterEach(() => {
    global.Event = previousEvent;
    dom.window.close();
  });

  it("should insert a safe image snippet from the attachment helper", () => {
    const textarea = dom.window.document.querySelector("textarea");
    textarea.value = "";
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;

    applyMarkdownSnippet(textarea, "attachment-image");

    expect(textarea.value).toBe("![Açıklama](https://example.com/gorsel.png)");
  });

  it("should insert a safe audio snippet from the attachment helper", () => {
    const textarea = dom.window.document.querySelector("textarea");
    textarea.value = "";
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;

    applyMarkdownSnippet(textarea, "attachment-audio");

    expect(textarea.value).toBe('<audio controls src="https://example.com/ses.mp3"></audio>');
  });

  it("should render the attachment button with a direct file input and no picker menu", () => {
    const markup = renderEditorToolbarButtons(primaryMarkdownActions, "card-1");

    expect(markup).toContain('data-editor-attachment-toggle="card-1"');
    expect(markup).toContain('data-editor-attachment-input="card-1"');
    expect(markup).toContain('accept="image/png, image/jpeg, image/webp, audio/mpeg, audio/wav, audio/ogg"');
    expect(markup).not.toContain("editor-attachment-menu");
    expect(markup).not.toContain("data-editor-attachment-kind");
  });
});
