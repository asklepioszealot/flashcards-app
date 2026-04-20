import { describe, expect, it } from "vitest";
import {
  buildReleasePlan,
  detectUpdaterSigningPlan,
  joinTargetPath,
  resolveFlashcardsUpdaterKeyPath,
} from "../../tools/release-plan.mjs";

describe("release plan", () => {
  it("keeps Windows separators when joining against Windows roots", () => {
    expect(
      joinTargetPath(
        "D:\\Git Projelerim\\flashcards-app\\.worktrees\\flashcards-release-dry-run",
        "release",
        "artifacts",
      ),
    ).toBe(
      "D:\\Git Projelerim\\flashcards-app\\.worktrees\\flashcards-release-dry-run\\release\\artifacts",
    );
  });

  it("keeps POSIX separators when joining against POSIX roots", () => {
    expect(joinTargetPath("/home/runner/work/flashcards", "release", "artifacts")).toBe(
      "/home/runner/work/flashcards/release/artifacts",
    );
  });

  it("resolves the flashcards-specific local updater key path", () => {
    expect(resolveFlashcardsUpdaterKeyPath("C:\\Users\\Ahmet")).toBe(
      "C:\\Users\\Ahmet\\.tauri\\flashcards-app-updater.key",
    );
  });

  it("detects when updater artifacts should be disabled because no key exists", () => {
    const plan = detectUpdaterSigningPlan({
      env: {},
      homeDir: "C:\\Users\\Ahmet",
      existsSyncRef() {
        return false;
      },
    });

    expect(plan).toEqual({
      defaultKeyPath: "C:\\Users\\Ahmet\\.tauri\\flashcards-app-updater.key",
      keySource: "missing",
      shouldLoadDefaultKey: false,
      updaterArtifactsEnabled: false,
    });
  });

  it("prefers inline env keys over local defaults", () => {
    const plan = detectUpdaterSigningPlan({
      env: {
        TAURI_SIGNING_PRIVATE_KEY: "inline-secret",
      },
      homeDir: "C:\\Users\\Ahmet",
      existsSyncRef() {
        return true;
      },
    });

    expect(plan.keySource).toBe("env-inline");
    expect(plan.shouldLoadDefaultKey).toBe(false);
    expect(plan.updaterArtifactsEnabled).toBe(true);
  });

  it("builds a dry-run friendly release plan without mutating disk", () => {
    const releasePlan = buildReleasePlan({
      repoRoot: "D:\\Git Projelerim\\flashcards-app\\.worktrees\\flashcards-release-dry-run",
      productName: "Flashcards App",
      version: "0.1.0",
      commit: "abc1234",
      timestamp: "20260420-193000",
      buildId: "build-42",
      noLegacyCopy: true,
      updaterSigningPlan: {
        defaultKeyPath: "C:\\Users\\Ahmet\\.tauri\\flashcards-app-updater.key",
        keySource: "missing",
        shouldLoadDefaultKey: false,
        updaterArtifactsEnabled: false,
      },
    });

    expect(releasePlan.releaseDir).toBe(
      "D:\\Git Projelerim\\flashcards-app\\.worktrees\\flashcards-release-dry-run\\release\\20260420-193000_v0.1.0_abc1234",
    );
    expect(releasePlan.latestPointerPath).toBe(
      "D:\\Git Projelerim\\flashcards-app\\.worktrees\\flashcards-release-dry-run\\LATEST_RELEASE_POINTER.txt",
    );
    expect(releasePlan.openPortableInfoPath).toBe(
      joinTargetPath(releasePlan.releaseDir, "OPEN_THIS_PORTABLE.txt"),
    );
    expect(releasePlan.pointerEntries).toEqual([
      `latest_release_dir=${releasePlan.releaseDir}`,
      `portable_exe=${releasePlan.portableTarget}`,
      `setup_exe=${releasePlan.setupTarget}`,
      "build_id=build-42",
      "legacy_copy=False",
    ]);
    expect(releasePlan.dryRunSummary.updaterKeySource).toBe("missing");
    expect(releasePlan.dryRunSummary.updaterArtifacts).toBe("disabled");
    expect(releasePlan.dryRunSummary.legacyCopy).toBe("disabled");
  });
});
