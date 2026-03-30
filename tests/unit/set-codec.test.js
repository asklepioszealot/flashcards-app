import { describe, expect, it } from "vitest";
import {
  buildEditorDraft,
  htmlToEditableMarkdown,
  renderAnswerMarkdown,
} from "../../src/core/set-codec.js";

describe("Set codec blockquote roundtrip", () => {
  it("preserves quoted markdown lines without inserting blank quoted rows", () => {
    const markdown = "> Tuzak:\n> Ornek cumle.";

    expect(htmlToEditableMarkdown(renderAnswerMarkdown(markdown))).toBe(markdown);
  });

  it("keeps blockquote formatting stable when building an editor draft", () => {
    const markdown = "> Tuzak:\n> Ornek cumle.";
    const draft = buildEditorDraft({
      id: "set-1",
      setName: "Deneme",
      sourceFormat: "markdown",
      fileName: "deneme.md",
      cards: [
        {
          id: "card-1",
          q: "Soru",
          a: renderAnswerMarkdown(markdown),
          subject: "Genel",
        },
      ],
    });

    expect(draft.cards[0]?.explanationMarkdown).toBe(markdown);
  });
});
