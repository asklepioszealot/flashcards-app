import { describe, expect, it } from "vitest";
import {
  buildMediaMarkdownSnippet,
  prepareMediaUpload,
  resolveMediaUploadErrorMessage,
  validateMediaUpload,
} from "../../src/features/editor/editor-media.js";
import {
  FLASHCARD_AUDIO_MAX_BYTES,
  FLASHCARD_IMAGE_MAX_BYTES,
} from "../../src/shared/constants.js";

function createSizedFile(sizeBytes, fileName, mimeType) {
  return new File([new Uint8Array(sizeBytes)], fileName, { type: mimeType });
}

describe("Editor media upload helpers", () => {
  it("should prepare a supported image upload with a generated media path", async () => {
    const file = createSizedFile(1024, "brain.png", "image/png");

    const prepared = await prepareMediaUpload(file, { intendedKind: "image" });

    expect(prepared.kind).toBe("image");
    expect(prepared.mimeType).toBe("image/png");
    expect(prepared.objectPath).toMatch(/^media\/.+\.png$/);
  });

  it("should reject oversized image uploads after validation", () => {
    const file = createSizedFile(FLASHCARD_IMAGE_MAX_BYTES + 1, "large.png", "image/png");

    expect(() => validateMediaUpload(file)).toThrow("Gorseller 2 MB veya daha kucuk olmali.");
  });

  it("should reject oversized audio uploads after validation", () => {
    const file = createSizedFile(FLASHCARD_AUDIO_MAX_BYTES + 1, "lecture.mp3", "audio/mpeg");

    expect(() => validateMediaUpload(file)).toThrow("Ses dosyalari 5 MB veya daha kucuk olmali.");
  });

  it("should build markdown and html snippets for uploaded media", () => {
    expect(buildMediaMarkdownSnippet("image", "https://example.com/image.webp"))
      .toBe("![Image](https://example.com/image.webp)");
    expect(buildMediaMarkdownSnippet("audio", "https://example.com/audio.mp3"))
      .toBe('<audio controls src="https://example.com/audio.mp3"></audio>');
  });

  it("should surface the SQL migration hint for outdated media RPC functions", () => {
    expect(
      resolveMediaUploadErrorMessage({
        code: "MEDIA_UPLOAD_SQL_UPDATE_REQUIRED",
        message: "Supabase medya fonksiyonlari eski surumde gorunuyor.",
      }),
    ).toBe("Supabase medya fonksiyonlari eski surumde gorunuyor.");
  });
});
