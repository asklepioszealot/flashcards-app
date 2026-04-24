// No imports — pure module.

const NAMED_COLORS = {
  yellow:   "#ffff00",
  red:      "#ff0000",
  green:    "#008000",
  blue:     "#0000ff",
  purple:   "#800080",
  orange:   "#ffa500",
  pink:     "#ffc0cb",
  cyan:     "#00ffff",
  magenta:  "#ff00ff",
  lime:     "#00ff00",
  teal:     "#008080",
  indigo:   "#4b0082",
  violet:   "#ee82ee",
  gray:     "#808080",
  grey:     "#808080",
  black:    "#000000",
  white:    "#ffffff",
};

const UNSAFE_PATTERN = /url\s*\(|var\s*\(|calc\s*\(|expression\s*\(/i;

// Convert r,g,b each in [0,1] to { h, s, l } with h in [0,360), s and l in [0,1].
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  h = (h / 6) * 360;
  return { h, s, l };
}

// Parse a hex string like "#rgb", "#rrggbb", "#rgba", "#rrggbbaa".
// Returns { r, g, b, a } each in [0,1] or null.
function parseHex(hex) {
  const clean = hex.replace(/^#/, "");
  let r, g, b, a = 1;
  if (clean.length === 3 || clean.length === 4) {
    r = parseInt(clean[0] + clean[0], 16) / 255;
    g = parseInt(clean[1] + clean[1], 16) / 255;
    b = parseInt(clean[2] + clean[2], 16) / 255;
    if (clean.length === 4) {
      a = parseInt(clean[3] + clean[3], 16) / 255;
    }
  } else if (clean.length === 6 || clean.length === 8) {
    r = parseInt(clean.slice(0, 2), 16) / 255;
    g = parseInt(clean.slice(2, 4), 16) / 255;
    b = parseInt(clean.slice(4, 6), 16) / 255;
    if (clean.length === 8) {
      a = parseInt(clean.slice(6, 8), 16) / 255;
    }
  } else {
    return null;
  }
  if ([r, g, b, a].some(isNaN)) return null;
  return { r, g, b, a };
}

// Parse hsl/hsla: hsl(h, s%, l%) or hsla(h, s%, l%, a).
function parseHslString(str) {
  const m = str.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (!m) return null;
  const h = parseFloat(m[1]);
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  if ([h, s, l, a].some(isNaN)) return null;
  return { h: ((h % 360) + 360) % 360, s, l, a };
}

/**
 * Parse any CSS color string into { h, s, l, a }.
 * Returns null on failure or if the string contains unsafe patterns.
 */
export function parseColorToHsl(cssColor) {
  if (typeof cssColor !== "string") return null;
  const trimmed = cssColor.trim();
  if (!trimmed) return null;
  if (UNSAFE_PATTERN.test(trimmed)) return null;

  // rgba / rgb
  const rgbMatch = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (rgbMatch) {
    const r = parseFloat(rgbMatch[1]) / 255;
    const g = parseFloat(rgbMatch[2]) / 255;
    const b = parseFloat(rgbMatch[3]) / 255;
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    if ([r, g, b, a].some(isNaN)) return null;
    const hsl = rgbToHsl(r, g, b);
    return { ...hsl, a };
  }

  // hex
  if (trimmed.startsWith("#")) {
    const rgba = parseHex(trimmed);
    if (!rgba) return null;
    const hsl = rgbToHsl(rgba.r, rgba.g, rgba.b);
    return { ...hsl, a: rgba.a };
  }

  // hsl / hsla
  if (/^hsla?\(/i.test(trimmed)) {
    return parseHslString(trimmed);
  }

  // named color
  const lower = trimmed.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, lower)) {
    const rgba = parseHex(NAMED_COLORS[lower]);
    if (!rgba) return null;
    const hsl = rgbToHsl(rgba.r, rgba.g, rgba.b);
    return { ...hsl, a: 1 };
  }

  return null;
}

/**
 * Map an HSL result to a bucket class name.
 */
export function hueToBucket(hsl) {
  if (!hsl) return null;
  const { h, s, a } = hsl;
  if (a < 0.05) return null;
  if (s < 0.15) return "hl-default";
  if (h >= 340 || h < 20) return "hl-red";
  if (h >= 20 && h < 70) return "hl-yellow";
  if (h >= 70 && h < 170) return "hl-green";
  if (h >= 170 && h < 250) return "hl-blue";
  if (h >= 250 && h < 340) return "hl-purple";
  return "hl-default";
}

// Extract the value of background or background-color from a style string.
function extractBackgroundColor(styleString) {
  // Try background-color first, then background (shorthand).
  const bgColorMatch = styleString.match(/background-color\s*:\s*([^;]+)/i);
  if (bgColorMatch) return bgColorMatch[1].trim();
  const bgMatch = styleString.match(/background\s*:\s*([^;]+)/i);
  if (bgMatch) return bgMatch[1].trim();
  return null;
}

/**
 * Given a raw style attribute string, classify the background color into a bucket class.
 * Returns the class name or null.
 */
export function classifyMarkStyle(styleString) {
  if (typeof styleString !== "string") return null;
  if (UNSAFE_PATTERN.test(styleString)) return null;
  const colorValue = extractBackgroundColor(styleString);
  if (!colorValue) return null;
  const hsl = parseColorToHsl(colorValue);
  return hueToBucket(hsl);
}
