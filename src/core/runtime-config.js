const globalScope = typeof window !== "undefined" ? window : globalThis;
const buildTimeAppConfig =
  typeof __APP_CONFIG__ !== "undefined" &&
  __APP_CONFIG__ &&
  typeof __APP_CONFIG__ === "object"
    ? __APP_CONFIG__
    : {};

const DEFAULT_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  authMode: "mock",
  enableDemoAuth: true,
  driveClientId: "",
  driveApiKey: "",
  driveAppId: "",
});

export function getRuntimeConfig() {
  const runtimeOverride =
    globalScope.APP_CONFIG && typeof globalScope.APP_CONFIG === "object"
      ? globalScope.APP_CONFIG
      : {};
  const config = {
    ...DEFAULT_CONFIG,
    ...buildTimeAppConfig,
    ...runtimeOverride,
  };

  return Object.freeze({
    ...config,
    authMode: config.supabaseUrl && config.supabaseAnonKey ? "supabase" : "mock",
  });
}

export function hasSupabaseConfig() {
  const config = getRuntimeConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function hasDriveConfig() {
  const config = getRuntimeConfig();
  return Boolean(config.driveClientId && config.driveApiKey);
}

export function isDesktopRuntime() {
  return Boolean(globalScope.__TAURI__?.core?.invoke);
}
