import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AVAILABLE_THEMES,
  ThemeManager,
  getThemeLabel,
} from "../../src/ui/theme.js";

describe("theme manager", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.body.innerHTML = "";
    delete globalThis.AppStorage;
  });

  it("renders legacy and Theme Factory labels", () => {
    expect(AVAILABLE_THEMES).toHaveLength(14);
    expect(getThemeLabel("light")).toBe("Aydınlık");
    expect(getThemeLabel("midnight")).toBe("Karanlık");
    expect(getThemeLabel("ember")).toBe("Amber");
    expect(getThemeLabel("dark")).toBe("Mavi");
    expect(getThemeLabel("ocean-depths")).toBe("Ocean Depths");
    expect(getThemeLabel("midnight-galaxy")).toBe("Midnight Galaxy");
  });

  it("falls back to global AppStorage when storageApi is omitted", () => {
    document.body.innerHTML = `<select id="theme-select-auth"></select>`;
    ThemeManager.renderThemeOptions(["theme-select-auth"]);

    const setItem = vi.fn();
    globalThis.AppStorage = { setItem };

    ThemeManager.setTheme({
      themeName: "ember",
      controlIds: ["theme-select-auth"],
      storageKey: "flashcards-theme",
    });

    expect(setItem).toHaveBeenCalledWith("flashcards-theme", "ember");
  });

  it("exposes ThemeManager on the global scope", () => {
    expect(globalThis.ThemeManager).toBe(ThemeManager);
  });
});
