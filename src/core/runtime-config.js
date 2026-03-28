import { APP_CONFIG } from "../generated/runtime-config.js";

const DEFAULT_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  authMode: "mock",
  enableDemoAuth: true,
});

export function getRuntimeConfig() {
  return Object.freeze({
    ...DEFAULT_CONFIG,
    ...APP_CONFIG,
  });
}

export function hasSupabaseConfig() {
  const config = getRuntimeConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function isDesktopRuntime() {
  return Boolean(globalThis.__TAURI__?.core?.invoke);
}
