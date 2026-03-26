const DEFAULT_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  authMode: "mock",
  enableDemoAuth: true,
});

export function getRuntimeConfig() {
  const runtimeConfig =
    globalThis.__APP_CONFIG__ && typeof globalThis.__APP_CONFIG__ === "object"
      ? globalThis.__APP_CONFIG__
      : {};

  return Object.freeze({
    ...DEFAULT_CONFIG,
    ...runtimeConfig,
  });
}

export function hasSupabaseConfig() {
  const config = getRuntimeConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function isDesktopRuntime() {
  return Boolean(globalThis.__TAURI__?.core?.invoke);
}
