import { beforeEach, describe, expect, it } from "vitest";
import { parseSetText } from "../../src/core/set-codec.js";
import {
  findRemovedSetMatch,
  forgetRemovedSetMatch,
  initStorageHelpers,
  rememberRemovedSetMatches,
} from "../../src/features/set-manager/set-manager.js";

describe("Set manager local reimport matching", () => {
  const removedSourcePath = "C:\\sets\\pediatri-demo.md";
  const removedRecord = {
    id: "set-existing",
    slug: "pediatri-demo",
    setName: "Pediatri Demo",
    fileName: "pediatri-demo.md",
    sourceFormat: "markdown",
    sourcePath: removedSourcePath,
    rawSource: [
      "# Pediatri Demo",
      "",
      "### Ilk soru?",
      "Konu: Genel",
      "",
      "Ilk cevap",
      "",
      "### Ikinci soru?",
      "Konu: Genel",
      "",
      "Ikinci cevap",
    ].join("\n"),
    cards: [
      {
        id: "card-existing-1",
        q: "Ilk soru?",
        a: "<p>Ilk cevap</p>",
        subject: "Genel",
      },
      {
        id: "card-existing-2",
        q: "Ikinci soru?",
        a: "<p>Ikinci cevap</p>",
        subject: "Genel",
      },
    ],
    updatedAt: "2026-03-30T10:00:00.000Z",
  };

  const reimportedMarkdown = [
    "# Pediatri Demo",
    "",
    "### Ilk soru?",
    "Konu: Genel",
    "",
    "Ilk cevap",
    "",
    "### Ikinci soru?",
    "Konu: Genel",
    "",
    "Ikinci cevap",
  ].join("\n");

  let storageState;

  beforeEach(() => {
    storageState = new Map();
    initStorageHelpers(
      (key, fallbackValue) => {
        if (!storageState.has(key)) return fallbackValue;
        return JSON.parse(storageState.get(key));
      },
      (key, value) => {
        storageState.set(key, JSON.stringify(value));
      },
    );
  });

  it("reuses the removed local set identity for the same source path", () => {
    rememberRemovedSetMatches([removedRecord]);

    const preservedRecord = findRemovedSetMatch(removedSourcePath);
    const freshImport = parseSetText(reimportedMarkdown, removedRecord.fileName, null, "markdown");
    const restoredImport = parseSetText(reimportedMarkdown, removedRecord.fileName, preservedRecord, "markdown");

    expect(preservedRecord?.id).toBe("set-existing");
    expect(freshImport.id).not.toBe("set-existing");
    expect(restoredImport.id).toBe("set-existing");
    expect(restoredImport.cards.map((card) => card.id)).toEqual(["card-existing-1", "card-existing-2"]);
  });

  it("forgets a removed local set match after reimport succeeds", () => {
    rememberRemovedSetMatches([removedRecord]);

    forgetRemovedSetMatch(removedSourcePath);

    expect(findRemovedSetMatch(removedSourcePath)).toBeNull();
  });
});
