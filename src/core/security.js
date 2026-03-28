import DOMPurify from "../../vendor/purify.es.mjs";

const EXPORT_SANITIZATION_CONFIG = {
  ALLOWED_TAGS: [
    "b", "i", "strong", "em", "code", "pre", "table", "tr", "td", "th", 
    "ul", "ol", "li", "br", "div", "span", "p"
  ],
  FORBID_TAGS: ["script", "iframe"],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeHtml(html, configOverrides = {}) {
  if (typeof html !== "string") {
    return "";
  }
  
  const config = {
    ...EXPORT_SANITIZATION_CONFIG,
    ...configOverrides
  };

  return DOMPurify.sanitize(html, config);
}
