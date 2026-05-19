use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.asklepioszealot.flashcards";
#[cfg(target_os = "android")]
const PLUGIN_CLASS: &str = "AndroidUpdaterPlugin";

#[cfg(target_os = "android")]
pub struct AndroidUpdater<R: Runtime>(pub PluginHandle<R>);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadArgs {
  url: String,
  version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResponse {
  pub status: String,
  #[serde(default)]
  pub path: Option<String>,
}

/// Download an APK from the given URL and hand it to Android's package
/// installer. JS calls this after picking up a new GitHub Release.
#[tauri::command]
pub async fn download_and_install_apk<R: Runtime>(
  app: AppHandle<R>,
  url: String,
  version: String,
) -> Result<DownloadResponse, String> {
  #[cfg(target_os = "android")]
  {
    let handle = app.try_state::<AndroidUpdater<R>>().ok_or_else(|| {
      "AndroidUpdaterPlugin native bridge yüklenmedi. Build loglarını kontrol et.".to_string()
    })?;
    let response: DownloadResponse = handle
      .0
      .run_mobile_plugin("downloadAndInstall", DownloadArgs { url, version })
      .map_err(|error| error.to_string())?;
    Ok(response)
  }

  #[cfg(not(target_os = "android"))]
  {
    let _ = (app, url, version);
    Err("APK güncelleyici sadece Android'de destekleniyor.".to_string())
  }
}

/// Mobile plugin scaffold. Mirrors `google_auth::init` — the command itself
/// is registered on the main app's invoke handler; this plugin only owns
/// the Android `PluginHandle` lifecycle.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  PluginBuilder::new("android-updater")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      {
        match api.register_android_plugin(PLUGIN_IDENTIFIER, PLUGIN_CLASS) {
          Ok(handle) => {
            app.manage(AndroidUpdater(handle));
          }
          Err(error) => {
            log::error!(
              "AndroidUpdaterPlugin native registration failed: {} (identifier={}, class={})",
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
