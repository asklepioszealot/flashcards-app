function normalizeNodeFilePath(fileUrl) {
  const resolvedUrl = new URL(fileUrl);
  let normalizedPath = decodeURIComponent(resolvedUrl.pathname);
  if (/^\/[a-zA-Z]:/.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice(1);
  }
  return normalizedPath;
}

export function resolveSqlWasmUrl() {
  if (typeof process !== "undefined" && process.versions?.node) {
    return `${process.cwd().replace(/\\/g, "/")}/node_modules/sql.js/dist/sql-wasm.wasm`;
  }
  const resolvedUrl = new URL("../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url);
  return resolvedUrl.href;
}
