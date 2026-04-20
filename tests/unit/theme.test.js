import { describe, expect, it } from "vitest";
import { AVAILABLE_THEMES, getThemeLabel } from "../../src/ui/theme.js";

describe("Theme labels", () => {
  it("renders legacy and Theme Factory labels", () => {
    expect(AVAILABLE_THEMES).toHaveLength(14);
    expect(getThemeLabel("light")).toBe("Aydınlık");
    expect(getThemeLabel("midnight")).toBe("Karanlık");
    expect(getThemeLabel("ember")).toBe("Amber");
    expect(getThemeLabel("dark")).toBe("Mavi");
    expect(getThemeLabel("ocean-depths")).toBe("Ocean Depths");
    expect(getThemeLabel("midnight-galaxy")).toBe("Midnight Galaxy");
  });
});
