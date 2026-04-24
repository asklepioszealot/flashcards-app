import DOMPurify from "dompurify";
import { classifyMarkStyle } from "./highlight-color.js";

const BASE_SANITIZATION_CONFIG = {
  FORBID_TAGS: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "meta",
    "link",
  ],
  FORBID_ATTR: ["style"],
  ALLOW_DATA_ATTR: false,
};

const IMAGE_DATA_URI_PATTERN = /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,[a-z0-9+/]+=*$/i;
const AUDIO_DATA_URI_PATTERN = /^data:audio\/(?:mpeg|mp3|ogg|wav|webm|aac|mp4);base64,[a-z0-9+/]+=*$/i;
const WEB_URI_PATTERN = /^https?:\/\//i;

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (node.tagName === "MARK" && data.attrName === "style") {
    const bucketClass = classifyMarkStyle(data.attrValue);
    if (bucketClass) {
      const existing = node.getAttribute("class");
      const classes = existing ? existing.split(/\s+/).filter(Boolean) : [];
      if (!classes.includes(bucketClass)) {
        classes.push(bucketClass);
      }
      node.setAttribute("class", classes.join(" "));
    }
  }
});

const BASIC_SANITIZATION_CONFIG = {
  ...BASE_SANITIZATION_CONFIG,
  ALLOWED_TAGS: ["b", "i", "strong", "em", "code", "pre", "table", "tr", "td", "th", "ul", "ol", "li", "br", "div", "span", "p"],
  ALLOWED_ATTR: ["class"],
};

export const MARKDOWN_SANITIZATION_CONFIG = {
  ...BASE_SANITIZATION_CONFIG,
  ALLOWED_TAGS: [
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "figure",
    "figcaption",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "mark",
    "audio",
    "ol",
    "p",
    "pre",
    "source",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  ALLOWED_ATTR: ["class", "href", "target", "rel", "title", "aria-label", "src", "alt", "controls", "preload", "loading", "type"],
  ADD_DATA_URI_TAGS: ["img", "audio", "source"],
};

function decodeAttributeValue(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function sanitizeMediaSource(source, mediaType = "image") {
  const normalizedSource = decodeAttributeValue(source).trim();
  if (!normalizedSource) return "";
  if (WEB_URI_PATTERN.test(normalizedSource)) return normalizedSource;
  if (mediaType === "image" && IMAGE_DATA_URI_PATTERN.test(normalizedSource)) return normalizedSource;
  if (mediaType === "audio" && AUDIO_DATA_URI_PATTERN.test(normalizedSource)) return normalizedSource;
  return "";
}

function enforceSafeMediaAttributes(html) {
  if (!html || typeof DOMParser !== "function") return html;

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const root = documentNode.body.firstElementChild;
    if (!root) return html;

    root.querySelectorAll("img").forEach((image) => {
      const safeSrc = sanitizeMediaSource(image.getAttribute("src"), "image");
      if (!safeSrc) {
        image.remove();
        return;
      }
      image.setAttribute("src", safeSrc);
      image.setAttribute("loading", "lazy");
      image.removeAttribute("srcset");
    });

    root.querySelectorAll("source").forEach((source) => {
      const mediaType = source.getAttribute("type")?.startsWith("audio/") ? "audio" : "image";
      const safeSrc = sanitizeMediaSource(source.getAttribute("src"), mediaType);
      if (!safeSrc) {
        source.remove();
        return;
      }
      source.setAttribute("src", safeSrc);
    });

    root.querySelectorAll("audio").forEach((audio) => {
      const safeSrc = sanitizeMediaSource(audio.getAttribute("src"), "audio");
      const validSources = [...audio.querySelectorAll("source")].filter((source) => sanitizeMediaSource(source.getAttribute("src"), "audio"));
      if (!safeSrc && !validSources.length) {
        audio.remove();
        return;
      }
      if (safeSrc) {
        audio.setAttribute("src", safeSrc);
      } else {
        audio.removeAttribute("src");
      }
      audio.setAttribute("controls", "");
      audio.setAttribute("preload", "metadata");
      audio.removeAttribute("autoplay");
    });

    return root.innerHTML;
  } catch {
    return html;
  }
}

export function sanitizeHtml(html, configOverrides = {}) {
  if (typeof html !== "string") {
    return "";
  }

  return DOMPurify.sanitize(html, {
    ...BASIC_SANITIZATION_CONFIG,
    ...configOverrides,
  });
}

export function sanitizeMarkdownHtml(html, configOverrides = {}) {
  return enforceSafeMediaAttributes(sanitizeHtml(html, {
    ...MARKDOWN_SANITIZATION_CONFIG,
    ...configOverrides,
  }));
}
