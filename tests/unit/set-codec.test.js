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

describe("Inline HTML passthrough through renderAnswerMarkdown", () => {
  it("preserves <mark> tags with a style attribute so the sanitizer can classify them", () => {
    const markdown = '<mark style="background:rgba(240, 200, 0, 0.2)">odem patogenezi</mark>';
    const html = renderAnswerMarkdown(markdown);

    expect(html).toContain("<mark");
    expect(html).toContain("hl-yellow");
    expect(html).toContain("odem patogenezi");
    expect(html).not.toContain("&lt;mark");
  });

  it("preserves <mark> tags inside inline text (before and after plain content)", () => {
    const markdown = 'Tani: <mark style="background:rgba(74, 222, 128, 0.3)">Meningokoksemi</mark> -- PEDIATRIK ACIL';
    const html = renderAnswerMarkdown(markdown);

    expect(html).toContain("<mark");
    expect(html).toContain("hl-green");
    expect(html).toContain("Meningokoksemi");
    expect(html).toContain("Tani:");
    expect(html).toContain("PEDIATRIK ACIL");
  });

  it("still escapes arbitrary HTML tags that are not in the passthrough list", () => {
    const markdown = '<script>alert(1)</script><mark>safe</mark>';
    const html = renderAnswerMarkdown(markdown);

    expect(html).toContain("<mark>safe</mark>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("preserves <sub> and <sup> tags through the renderer", () => {
    const markdown = 'H<sub>2</sub>O and x<sup>2</sup>';
    const html = renderAnswerMarkdown(markdown);

    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
  });

  it("applies bold/italic markdown inside <mark> content", () => {
    const markdown = '<mark>**bold** and *italic*</mark>';
    const html = renderAnswerMarkdown(markdown);

    expect(html).toContain("<mark>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });
});
