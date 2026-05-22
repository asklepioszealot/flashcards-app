import { describe, expect, it } from "vitest";
import { selectLatestAndroidRelease } from "../../src/features/android-update/android-update.js";

describe("Android updater release selection", () => {
  it("ignores the repository latest release when it belongs to desktop", () => {
    const selected = selectLatestAndroidRelease([
      {
        tag_name: "desktop-v0.1.13",
        draft: false,
        prerelease: false,
        assets: [{ name: "latest.json", browser_download_url: "https://example.com/latest.json" }],
      },
      {
        tag_name: "android-v0.1.12",
        draft: false,
        prerelease: false,
        body: "Android fixes",
        assets: [{ name: "app-universal-release.apk", browser_download_url: "https://example.com/app.apk", size: 42 }],
      },
    ]);

    expect(selected).toMatchObject({
      version: "0.1.12",
      tagName: "android-v0.1.12",
      downloadUrl: "https://example.com/app.apk",
      size: 42,
      notes: "Android fixes",
    });
  });

  it("uses semver order instead of release list order", () => {
    const selected = selectLatestAndroidRelease([
      {
        tag_name: "android-v0.1.9",
        draft: false,
        prerelease: false,
        assets: [{ name: "app.apk", browser_download_url: "https://example.com/old.apk" }],
      },
      {
        tag_name: "android-v0.1.10",
        draft: false,
        prerelease: false,
        assets: [{ name: "app.apk", browser_download_url: "https://example.com/new.apk" }],
      },
    ]);

    expect(selected.version).toBe("0.1.10");
    expect(selected.downloadUrl).toBe("https://example.com/new.apk");
  });

  it("skips drafts, prereleases, and malformed android tags", () => {
    const selected = selectLatestAndroidRelease([
      { tag_name: "android-v0.2.0", draft: true, prerelease: false, assets: [] },
      { tag_name: "android-v0.1.99", draft: false, prerelease: true, assets: [] },
      { tag_name: "android-vnext", draft: false, prerelease: false, assets: [] },
    ]);

    expect(selected).toBeNull();
  });
});
