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
});
