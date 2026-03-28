import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../../src/core/security.js';

describe('Security core module - sanitizeHtml', () => {
  it('should remove script tags and on* attributes but keep allowed tags', () => {
    const input = `<script>alert(1)</script><b onclick="alert(2)">Test</b><p>Safe content</p>`;
    const output = sanitizeHtml(input);
    expect(output).toBe('<b>Test</b><p>Safe content</p>');
  });

  it('should filter disallowed attributes like iframes', () => {
    const input = `<iframe src="https://evil.com"></iframe><em>Italics</em>`;
    const output = sanitizeHtml(input);
    expect(output).toBe('<em>Italics</em>');
  });
});
