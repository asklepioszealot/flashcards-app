// src/ui/desktop.js
// Custom Titlebar, Statusbar, Drag & Drop and OS integrations for Windows 11 desktop runtime.

import { isDesktopRuntime, isTauriRuntime } from "../core/runtime-config.js";
import { platformAdapter } from "../app/state.js";

// Helper to get Tauri APIs safely
function getTauri() {
  return window.__TAURI__ || null;
}

export function initDesktopIntegrations() {
  if (!isTauriRuntime()) {
    return;
  }

  // 1. Apply desktop-specific classes for transparent Mica background and paddings
  document.documentElement.classList.add("tauri-desktop-html");
  document.body.classList.add("tauri-desktop");

  if (!isDesktopRuntime()) {
    // Android specific setups are handled elsewhere, stop here for desktop
    return;
  }

  const tauri = getTauri();
  if (!tauri) return;

  const { getCurrentWindow } = tauri.window;
  const appWindow = getCurrentWindow();

  // 2. Wire Custom Titlebar Window Controls
  const minBtn = document.getElementById("titlebar-minimize");
  const maxBtn = document.getElementById("titlebar-maximize");
  const closeBtn = document.getElementById("titlebar-close");

  if (minBtn) {
    minBtn.addEventListener("click", () => {
      appWindow.minimize().catch(console.error);
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener("click", () => {
      appWindow.toggleMaximize().catch((err) => {
        console.error("Window maximize toggle failed:", err);
      });
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      appWindow.close().catch(console.error);
    });
  }

  // 2.5 Window dragging + dblclick maximize is handled natively by Tauri via
  // the `data-tauri-drag-region` attribute on .titlebar-drag-region. The
  // native handler distinguishes drag-vs-click and works on descendants, so
  // we no longer wire a JS mousedown handler here — doing so swallowed the
  // first click and prevented dblclick from firing.

  // 2.6 Wire F11 fullscreen toggle (hides custom titlebar via CSS class)
  setupFullscreenToggle(appWindow);

  // 2.7 Mirror maximize state to body class for CSS hooks (frames, edges, etc.).
  syncMaximizedClass(appWindow);
  try {
    if (typeof appWindow.onResized === "function") {
      appWindow.onResized(() => syncMaximizedClass(appWindow)).catch(console.error);
    }
  } catch (err) {
    console.error("onResized wire-up failed:", err);
  }

  // 3. Wire Offline / Online Sync Indicator
  setupSyncIndicators();

  // 4. Wire Global Drag & Drop Overlay
  setupDragAndDrop(tauri);

  // 5. Wire Single Instance Args & CLI Launch File Imports
  setupSingleInstanceArgs(tauri);
}

async function syncMaximizedClass(appWindow) {
  try {
    const isMax = await appWindow.isMaximized();
    document.body.classList.toggle("tauri-desktop-maximized", isMax);
  } catch (err) {
    console.error("Maximize state sync failed:", err);
  }
}

// F11 toggles native fullscreen; CSS class hides the custom titlebar to match.
function setupFullscreenToggle(appWindow) {
  let toggling = false;
  async function toggleFullscreen() {
    if (toggling) return;
    toggling = true;
    try {
      const isFs = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!isFs);
      document.body.classList.toggle("tauri-desktop-fullscreen", !isFs);
    } catch (err) {
      console.error("Fullscreen toggle failed:", err);
    } finally {
      toggling = false;
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault();
      void toggleFullscreen();
    }
  });
}

// Manage LED indicator classes
export function updateSyncIndicator(status, text) {
  const led = document.getElementById("sync-indicator-led");
  const label = document.getElementById("sync-status-text");
  if (!led || !label) return;

  led.className = "statusbar-indicator";
  if (status === "synced") {
    led.classList.add("status-synced");
  } else if (status === "offline") {
    led.classList.add("status-offline");
  } else {
    led.classList.add("status-error");
  }

  if (text) {
    label.textContent = text;
  }
}

function setupSyncIndicators() {
  const syncBtn = document.getElementById("sync-now-btn");
  if (!syncBtn) return;

  syncBtn.addEventListener("click", async () => {
    const adapter = platformAdapter;
    if (!adapter) {
      updateSyncIndicator("error", "Senkronizasyon adaptörü hazır değil.");
      return;
    }

    syncBtn.disabled = true;
    const originalText = syncBtn.textContent;
    syncBtn.textContent = "Senkronize ediliyor...";
    updateSyncIndicator("synced", "Bulut senkronizasyonu başlatıldı...");

    try {
      const { loadUserWorkspace } = await import("../features/study-state/study-state.js");
      await loadUserWorkspace();
      updateSyncIndicator("synced", "Bulut senkronizasyonu başarıyla tamamlandı.");
    } catch (err) {
      console.error("Sync failed:", err);
      updateSyncIndicator("error", `Senkronizasyon hatası: ${err.message || "Bilinmeyen hata"}`);
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = originalText;
    }
  });

  // Check network state
  window.addEventListener("online", () => {
    updateSyncIndicator("synced", "İnternet bağlantısı sağlandı. Eşitleniyor...");
    syncBtn.click();
  });

  window.addEventListener("offline", () => {
    updateSyncIndicator("offline", "Çevrimdışı çalışılıyor. Değişiklikler yerel olarak kaydedilecek.");
  });

  // Initial state check
  if (!navigator.onLine) {
    updateSyncIndicator("offline", "Çevrimdışı çalışılıyor. Değişiklikler yerel olarak kaydedilecek.");
  }
}

// Global Drag & Drop using Tauri Window API
function setupDragAndDrop(tauri) {
  const overlay = document.getElementById("desktop-dragdrop-zone");
  if (!overlay) return;

  const { listen } = tauri.event;

  // Listen to Tauri Drag Over event
  listen("tauri://drag-over", () => {
    overlay.classList.add("active");
  }).catch(console.error);

  // Listen to Tauri Drag Leave / Cancelled event
  listen("tauri://drag-leave", () => {
    overlay.classList.remove("active");
  }).catch(console.error);

  listen("tauri://drag-drop", async (event) => {
    overlay.classList.remove("active");
    const paths = event.payload?.paths;
    if (Array.isArray(paths) && paths.length > 0) {
      await importLocalFilesByPaths(paths);
    }
  }).catch(console.error);
}

async function handleDesktopDeepLink(url) {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("flashcards-app://")) return false;

  console.log("Desktop deep link intercepted:", url);

  // Parse OAuth Callback
  if (url.includes("/oauth-callback") || url.includes("oauth-callback")) {
    try {
      let paramStr = "";
      if (url.includes("#")) {
        paramStr = url.split("#")[1];
      } else if (url.includes("?")) {
        paramStr = url.split("?")[1];
      }

      if (!paramStr) return false;

      const params = new URLSearchParams(paramStr);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const code = params.get("code");

      const adapter = platformAdapter;
      
      if (code && adapter && typeof adapter.exchangeCodeForSession === "function") {
        console.log("Found PKCE code in deep link, exchanging...");
        updateSyncIndicator("synced", "Google ile giriş yapılıyor (PKCE)...");
        await adapter.exchangeCodeForSession(code);
        
        updateSyncIndicator("synced", "Giriş başarılı! Veriler yükleniyor...");
        if (typeof adapter.loadSets === "function") {
          await adapter.loadSets();
        }
        window.location.reload();
        return true;
      }
      else if (accessToken && adapter && typeof adapter.setSession === "function") {
        console.log("Found access token in deep link, authenticating...");
        updateSyncIndicator("synced", "Google ile giriş yapılıyor...");
        await adapter.setSession({
          access_token: accessToken,
          refresh_token: refreshToken || "",
        });
        updateSyncIndicator("synced", "Giriş başarılı! Veriler yükleniyor...");
        if (typeof adapter.loadSets === "function") {
          await adapter.loadSets();
        }
        // Force reload to refresh application state with new auth session
        window.location.reload();
        return true;
      }
    } catch (err) {
      console.error("Deep link auth session restore failed:", err);
      updateSyncIndicator("error", `Giriş başarısız: ${err.message || err}`);
    }
  }
  return false;
}

// Handle Single Instance arguments passing
function setupSingleInstanceArgs(tauri) {
  const { listen } = tauri.event;

  // Listen to arguments passed by later instances launched
  listen("single-instance-args", async (event) => {
    const args = event.payload;
    if (Array.isArray(args) && args.length > 1) {
      // Index 0 is executable path, index 1 onwards are arguments/file paths
      const filePaths = args.slice(1).filter(arg => !arg.startsWith("-"));
      
      const deepLinkUrl = filePaths.find(arg => arg.startsWith("flashcards-app://"));
      if (deepLinkUrl) {
        const { getCurrentWindow } = tauri.window;
        const currentWin = getCurrentWindow();
        await currentWin.setFocus().catch(console.error);

        const handled = await handleDesktopDeepLink(deepLinkUrl);
        if (handled) return;
      }

      const validPaths = filePaths.filter(arg => !arg.startsWith("flashcards-app://"));
      if (validPaths.length > 0) {
        // Bring window to focus
        const { getCurrentWindow } = tauri.window;
        const currentWin = getCurrentWindow();
        await currentWin.setFocus().catch(console.error);

        await importLocalFilesByPaths(validPaths);
      }
    }
  }).catch(console.error);

  // Check startup arguments on initial boot
  setTimeout(async () => {
    try {
      const core = tauri.core;
      if (core && typeof core.invoke === "function") {
        const args = await core.invoke("get_startup_args");
        if (Array.isArray(args) && args.length > 1) {
          const filePaths = args.slice(1).filter(arg => !arg.startsWith("-"));
          
          const deepLinkUrl = filePaths.find(arg => arg.startsWith("flashcards-app://"));
          if (deepLinkUrl) {
            const handled = await handleDesktopDeepLink(deepLinkUrl);
            if (handled) return;
          }

          const validPaths = filePaths.filter(arg => !arg.startsWith("flashcards-app://"));
          if (validPaths.length > 0) {
            await importLocalFilesByPaths(validPaths);
          }
        }
      }
    } catch (err) {
      console.warn("Could not read startup arguments:", err);
    }
  }, 1500); // Wait for boot transition to end
}

// Convert absolute Windows file paths to File-like records and import them
async function importLocalFilesByPaths(paths) {
  const tauri = getTauri();
  if (!tauri) return;

  const core = tauri.core;
  if (!core || typeof core.invoke !== "function") return;

  try {
    updateSyncIndicator("synced", `${paths.length} adet yerel dosya okunuyor...`);
    
    // We utilize the pick_native_set_files style but call a custom command or read them in Rust
    // Wait, let's read each file's metadata and content using Rust
    const loadedFiles = [];
    for (const path of paths) {
      // In platform-adapter.js we have a read_native_file method, let's call a native invoke
      // Let's see: we can use a custom tauri command to read the files, or read them directly if they are standard paths.
      // Wait, is there a way to call "pick_native_set_files" but passing specific paths? 
      // Actually we have a tauri command write_set_source_file. Do we have a read_local_file command?
      // Ah! In lib.rs we have:
      // fn read_native_file(path: &Path) -> Result<NativePickedFile, String>
      // But it's not exposed as a tauri command directly! It is called inside `pick_native_set_files`.
      // Let's see: can we add a tauri command `read_native_file_by_path` in `lib.rs`? 
      // Yes! That would be extremely elegant and clean!
      // Let's first make our frontend code invoke "read_native_file_by_path" with the path!
      const pickedFile = await core.invoke("read_native_file_by_path", { path });
      if (pickedFile) {
        loadedFiles.push(pickedFile);
      }
    }

    if (loadedFiles.length > 0) {
      // Trigger the standard frontend importer!
      // In set-manager.js we have handleImportedFiles(files). Let's load the module dynamically and import!
      const { handleImportedFiles } = await import("../features/set-manager/set-manager.js");
      
      // Map loadedFiles (which have: path, name, contents, binaryBase64) to File-like objects
      const filesMapped = loadedFiles.map(lf => {
        let blob;
        if (lf.binaryBase64) {
          const binaryStr = atob(lf.binaryBase64);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          blob = new Blob([bytes], { type: lf.name.endsWith(".apkg") ? "application/octet-stream" : "application/json" });
        } else {
          blob = new Blob([lf.contents], { type: lf.name.endsWith(".md") ? "text/markdown" : "application/json" });
        }
        
        // Mock File-like object
        return {
          name: lf.name,
          size: blob.size,
          type: blob.type,
          slice: (start, end, type) => blob.slice(start, end, type),
          text: async () => lf.contents || "",
          arrayBuffer: async () => {
            const reader = new FileReader();
            return new Promise((resolve) => {
              reader.onload = () => resolve(reader.result);
              reader.readAsArrayBuffer(blob);
            });
          },
          nativePath: lf.path // custom property to retain source path
        };
      });

      await handleImportedFiles(filesMapped);
      updateSyncIndicator("synced", `${filesMapped.length} dosya başarıyla içe aktarıldı.`);
    }
  } catch (err) {
    console.error("Local file import failed:", err);
    updateSyncIndicator("error", `Dosya okuma hatası: ${err.message || err}`);
  }
}
