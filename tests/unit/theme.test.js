import { describe, expect, it } from "vitest";
import { getThemeLabel } from "../../src/ui/theme.js";

describe("Theme labels", () => {
  it("should render theme names in uppercase", () => {
    expect(getThemeLabel("light")).toBe("AYDINLIK");
    expect(getThemeLabel("midnight")).toBe("KARANLIK");
    expect(getThemeLabel("ember")).toBe("AMBER");
    expect(getThemeLabel("dark")).toBe("MAVİ");
  });
});
