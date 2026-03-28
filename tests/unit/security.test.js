import { describe, it, expect } from "vitest";
import { parseSetText, renderAnswerMarkdown } from "../../src/core/set-codec.js";
import { sanitizeHtml, sanitizeMarkdownHtml } from "../../src/core/security.js";

describe("Security core module", () => {
  it("should remove script tags and on* attributes but keep allowed tags", () => {
    const input = `<script>alert(1)</script><b onclick="alert(2)">Test</b><p>Safe content</p>`;
    const output = sanitizeHtml(input);
    expect(output).toBe("<b>Test</b><p>Safe content</p>");
  });

  it("should filter disallowed tags like iframes", () => {
    const input = `<iframe src="https://evil.com"></iframe><em>Italics</em>`;
    const output = sanitizeHtml(input);
    expect(output).toBe("<em>Italics</em>");
  });

  it("should keep markdown-safe structure while stripping dangerous links", () => {
    const input = `<h2>Başlık</h2><a href="javascript:alert(1)" target="_blank" rel="noopener">Bağlantı</a><blockquote class="markdown-callout warning">Uyarı</blockquote>`;
    const output = sanitizeMarkdownHtml(input);

    expect(output).toContain("<h2>Başlık</h2>");
    expect(output).toContain('class="markdown-callout warning"');
    expect(output).not.toContain("javascript:");
  });

  it("should sanitize rendered markdown output before it reaches the DOM", () => {
    const output = renderAnswerMarkdown("Merhaba\n\n<script>alert(1)</script>\n\n[bağlantı](https://example.com)");

    expect(output).toContain("<p>Merhaba</p>");
    expect(output).toContain('<a href="https://example.com" target="_blank" rel="noreferrer noopener">bağlantı</a>');
    expect(output).not.toContain("<script>");
  });

  it("should sanitize unsafe HTML coming from JSON sets", () => {
    const parsed = parseSetText(
      JSON.stringify({
        setName: "Güvenlik",
        cards: [
          {
            q: "Soru",
            a: `<p>Güvenli</p><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">Tıkla</a>`,
            subject: "Genel",
          },
        ],
      }),
      "security.json",
    );

    expect(parsed.cards[0].a).toContain("<p>Güvenli</p>");
    expect(parsed.cards[0].a).not.toContain("onerror");
    expect(parsed.cards[0].a).not.toContain("<img");
    expect(parsed.cards[0].a).not.toContain("javascript:");
  });

  it("should render safe markdown media for images and audio", () => {
    const output = renderAnswerMarkdown(
      "![Beyin MR](https://example.com/brain.jpg)\n\n![audio: Dinleme](data:audio/mpeg;base64,QUJDRA==)",
    );

    expect(output).toContain("<img");
    expect(output).toContain("<audio");
    expect(output).toContain("Beyin MR");
    expect(output).not.toContain("javascript:");
  });
});
