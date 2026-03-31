import { describe, expect, it } from "vitest";
import { buildReleaseArtifactNames } from "../../tools/release-artifact-names.mjs";

describe("release artifact names", () => {
  it("uses the product name with spaces for portable and setup copies", () => {
    expect(
      buildReleaseArtifactNames({
        productName: "Flashcards App",
        version: "0.1.2",
        commit: "b2bd0a4",
      }),
    ).toEqual({
      portableName: "Flashcards App Portable v0.1.2_b2bd0a4.exe",
      setupName: "Flashcards App Kurulum v0.1.2_b2bd0a4.exe",
      legacyPortableName: "Flashcards App Portable.exe",
      legacySetupName: "Flashcards App Kurulum.exe",
    });
  });

  it("trims surrounding whitespace in the product name", () => {
    expect(
      buildReleaseArtifactNames({
        productName: "  Flashcards App  ",
        version: "0.1.2",
        commit: "b2bd0a4",
      }).portableName,
    ).toBe("Flashcards App Portable v0.1.2_b2bd0a4.exe");
  });
});
