use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.asklepioszealot.flashcards";
#[cfg(target_os = "android")]
const PLUGIN_CLASS: &str = "GoogleAuthPlugin";

/// Wrapper around the Android plugin handle so we can pull it back out of
/// Tauri-managed state inside the command handler. Desktop builds never
/// instantiate this.
#[cfg(target_os = "android")]
pub struct GoogleAuth<R: Runtime>(pub PluginHandle<R>);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(target_os = "android")]
struct SignInArgs {
  web_client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInResponse {
  pub id_token: String,
  #[serde(default)]
  pub email: Option<String>,
}

/// `signInWithGoogle` JS-facing command. Returns the Google ID token from
/// Android's Credential Manager so the JS layer can hand it to Supabase
/// `auth.signInWithIdToken({ provider: 'google', token })`.
#[tauri::command]
pub async fn sign_in_with_google<R: Runtime>(
  app: AppHandle<R>,
  web_client_id: String,
) -> Result<SignInResponse, String> {
  #[cfg(target_os = "android")]
  {
    let handle = app.try_state::<GoogleAuth<R>>().ok_or_else(|| {
      "GoogleAuthPlugin native bridge yüklenmedi. Build loglarını kontrol et."
        .to_string()
    })?;
    let response: SignInResponse = handle
      .0
      .run_mobile_plugin("signIn", SignInArgs { web_client_id })
      .map_err(|error| error.to_string())?;
    Ok(response)
  }

  #[cfg(not(target_os = "android"))]
  {
    let _ = (app, web_client_id);
    Err("Native Google sign-in sadece Android'de destekleniyor.".to_string())
  }
}

/// Tauri plugin that wires the Android Credential Manager bridge.
///
/// The command itself (`sign_in_with_google`) is registered on the main app's
/// invoke handler so it doesn't need a separate plugin capability entry; this
/// `init` only exists so the Android `PluginHandle` is acquired during setup
/// and stored in managed state.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  PluginBuilder::new("google-auth")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      {
        // Don't `?` the registration: if the Kotlin plugin class can't be
        // resolved (annotation processor missing, ClassNotFoundException, etc.)
        // we don't want the whole app to fail to start. Log it and continue;
        // calling sign_in_with_google later will return a clean error because
        // the GoogleAuth state never got managed.
        match api.register_android_plugin(PLUGIN_IDENTIFIER, PLUGIN_CLASS) {
          Ok(handle) => {
            app.manage(GoogleAuth(handle));
          }
          Err(error) => {
            log::error!(
              "GoogleAuthPlugin native registration failed: {} (identifier={}, class={})",
              error,
              PLUGIN_IDENTIFIER,
              PLUGIN_CLASS,
            );
          }
        }
      }
      #[cfg(not(target_os = "android"))]
      {
        let _ = (app, api);
      }
      Ok(())
    })
    .build()
}
