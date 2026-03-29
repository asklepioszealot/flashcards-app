const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  authMode: "mock",
  enableDemoAuth: true,
  driveClientId: "",
  driveApiKey: "",
  driveAppId: "",
});

export const APP_CONFIG = Object.freeze(
  typeof __APP_CONFIG__ !== "undefined" && __APP_CONFIG__ && typeof __APP_CONFIG__ === "object"
    ? __APP_CONFIG__
    : DEFAULT_RUNTIME_CONFIG,
);

export default APP_CONFIG;
