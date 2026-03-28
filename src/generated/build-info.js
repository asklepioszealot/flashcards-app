const DEFAULT_BUILD_INFO = Object.freeze({
  version: "unknown",
  commit: "nogit",
  builtAt: "",
  buildId: "dev",
  source: "vite",
});

export const BUILD_INFO = Object.freeze(
  typeof __BUILD_INFO__ !== "undefined" && __BUILD_INFO__ && typeof __BUILD_INFO__ === "object"
    ? __BUILD_INFO__
    : DEFAULT_BUILD_INFO,
);

export default BUILD_INFO;
