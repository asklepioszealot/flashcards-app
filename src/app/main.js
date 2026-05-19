// src/app/main.js
// Application entry point — imports bootstrap and starts the app.
import { bootstrap } from "./bootstrap.js";

bootstrap().catch((error) => {
  console.error(error);
  const authStatusEl = document.getElementById("auth-status");
  if (authStatusEl) {
    authStatusEl.className = "auth-status error";
    authStatusEl.textContent = error.message || "Uygulama başlatılamadı.";
  }
  document.getElementById("auth-screen")?.classList.remove("hidden");
  document.body.classList.remove("app-booting");
  const splash = document.getElementById("app-splash");
  if (splash) {
    const finalize = () => splash.classList.add("is-removed");
    splash.addEventListener("transitionend", finalize, { once: true });
    setTimeout(finalize, 800);
  }
});
