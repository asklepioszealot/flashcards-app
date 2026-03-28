const ICON_NAME_PATTERN = /^[a-z0-9-]+$/;

function normalizeIconName(iconName) {
  return ICON_NAME_PATTERN.test(String(iconName || "")) ? String(iconName) : "file-text";
}

function normalizeClassName(className) {
  return String(className || "icon icon--sm")
    .trim()
    .replace(/\s+/g, " ");
}

export function renderIcon(iconName, className = "icon icon--sm") {
  const normalizedName = normalizeIconName(iconName);
  const normalizedClassName = normalizeClassName(className);
  return `<svg class="${normalizedClassName}" aria-hidden="true" focusable="false"><use href="#icon-${normalizedName}"></use></svg>`;
}

export function setButtonIcon(button, iconName, options = {}) {
  if (!button) return;
  button.innerHTML = renderIcon(iconName, options.className || "icon icon--md");
  if (typeof options.label === "string" && options.label.trim()) {
    button.setAttribute("aria-label", options.label);
  }
  if (typeof options.title === "string") {
    button.title = options.title;
  }
}

export default Object.freeze({
  renderIcon,
  setButtonIcon,
});
