import { describe, expect, it } from "vitest";
import { generateApkg } from "../../src/features/study/study-export.js";
import { parseApkgToSetRecord } from "../../src/features/importers/apkg-import.js";

describe("APKG import", () => {
  it("should convert an exported apkg back into the app's default set shape", async () => {
    const apkgBlob = await generateApkg([
      {
        q: "Sinir sistemi nedir?",
        a: "<p>Merkezi ve periferik sinir sisteminden oluşur.</p>",
        subject: "Noroloji",
        __setId: "set-neuro",
        __cardKey: "card-neuro-1",
      },
    ]);

    const parsed = await parseApkgToSetRecord(await apkgBlob.arrayBuffer(), "noroloji.apkg");

    expect(parsed.sourceFormat).toBe("json");
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].q).toContain("Sinir sistemi");
    expect(parsed.cards[0].a).toContain("Merkezi ve periferik");
    expect(parsed.cards[0].subject).toBe("Noroloji");
  });
});
