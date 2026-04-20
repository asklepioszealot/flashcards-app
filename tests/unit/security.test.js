import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { parseSetText, renderAnswerMarkdown } from "../../src/core/set-codec.js";
import { sanitizeHtml, sanitizeMarkdownHtml } from "../../src/core/security.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function getTrackedFilesForSecurityScan() {
  const output = execFileSync(
    "git",
    [
      "ls-files",
      "src",
      ".github/workflows",
      "tools",
      "vite.config.mjs",
      "package.json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  return output
    .split(/\r?\n/)
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .filter((filePath) => !filePath.endsWith(".gitkeep"));
}

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

  it("should keep safe image and audio sources while stripping unsafe media attributes", () => {
    const output = sanitizeHtml(
      [
        '<img src="https://cdn.example.com/brain.png" alt="Beyin" onclick="alert(1)" />',
        '<audio src="data:audio/mpeg;base64,QUJD" autoplay></audio>',
        '<audio src="javascript:alert(2)"></audio>',
      ].join(""),
    );

    expect(output).toContain(
      '<img src="https://cdn.example.com/brain.png" alt="Beyin" loading="lazy">',
    );
    expect(output).toContain(
      '<audio src="data:audio/mpeg;base64,QUJD" controls="" preload="metadata"></audio>',
    );
    expect(output).not.toContain("onclick");
    expect(output).not.toContain("autoplay");
    expect(output).not.toContain("javascript:");
  });

  it("should keep markdown-safe structure while stripping dangerous links", () => {
    const input = `<h2>Başlık</h2><a href="javascript:alert(1)" target="_blank" rel="noopener">Bağlantı</a><blockquote class="markdown-callout warning">Uyarı</blockquote>`;
    const output = sanitizeMarkdownHtml(input);

    expect(output).toContain("<h2>Başlık</h2>");
    expect(output).toContain('class="markdown-callout warning"');
    expect(output).not.toContain("javascript:");
  });

  it("should add noopener noreferrer to blank-target links", () => {
    const output = sanitizeMarkdownHtml('<a href="https://example.com" target="_blank">bağlantı</a>');

    expect(output).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">bağlantı</a>');
  });

  it("should sanitize rendered markdown output before it reaches the DOM", () => {
    const output = renderAnswerMarkdown("Merhaba\n\n<script>alert(1)</script>\n\n[bağlantı](https://example.com)");

    expect(output).toContain("<p>Merhaba</p>");
    expect(output).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">bağlantı</a>');
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

  it("should not keep hardcoded Google Drive API keys in source files", () => {
    const trackedSource = getTrackedFilesForSecurityScan()
      .map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8"))
      .join("\n");

    expect(trackedSource).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(trackedSource).not.toMatch(/ghp_[0-9A-Za-z]{20,}/);
    expect(trackedSource).not.toMatch(/sk_(live|test)_[0-9A-Za-z]{16,}/);
    expect(trackedSource).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(trackedSource).not.toContain("BEGIN PRIVATE KEY");
  });

  it("should include a restrictive CSP meta tag in index.html", () => {
    const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

    expect(indexHtml).toContain('http-equiv="Content-Security-Policy"');
    expect(indexHtml).toContain("default-src 'none'");
    expect(indexHtml).toContain("script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com");
    expect(indexHtml).toContain("worker-src blob:");
    expect(indexHtml).toContain("frame-ancestors 'none'");
  });
});
