import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseArtifactNames } from "./release-artifact-names.mjs";

export function usesWindowsPathSemantics(candidatePath) {
  if (typeof candidatePath !== "string" || candidatePath.length === 0) {
    return false;
  }

  return /^[A-Za-z]:[\\/]/.test(candidatePath) || candidatePath.startsWith("\\\\");
}

export function joinTargetPath(basePath, ...segments) {
  const pathApi = usesWindowsPathSemantics(basePath) ? path.win32 : path.posix;
  return pathApi.join(basePath, ...segments);
}

export function resolveFlashcardsUpdaterKeyPath(homeDir = os.homedir()) {
  return joinTargetPath(homeDir, ".tauri", "flashcards-app-updater.key");
}

export function detectUpdaterSigningPlan({
  env = process.env,
  homeDir = os.homedir(),
  existsSyncRef = fs.existsSync,
} = {}) {
  const hasInlineKey =
    typeof env.TAURI_SIGNING_PRIVATE_KEY === "string" &&
    env.TAURI_SIGNING_PRIVATE_KEY.trim().length > 0;
  const hasKeyPath =
    typeof env.TAURI_SIGNING_PRIVATE_KEY_PATH === "string" &&
    env.TAURI_SIGNING_PRIVATE_KEY_PATH.trim().length > 0;
  const defaultKeyPath = resolveFlashcardsUpdaterKeyPath(homeDir);
  const hasDefaultKey = existsSyncRef(defaultKeyPath);

  let keySource = "missing";
  if (hasInlineKey) {
    keySource = "env-inline";
  } else if (hasKeyPath) {
    keySource = "env-path";
  } else if (hasDefaultKey) {
    keySource = "local-default";
  }

  const shouldLoadDefaultKey = keySource === "local-default";

  return {
    defaultKeyPath,
    keySource,
    shouldLoadDefaultKey,
    updaterArtifactsEnabled: keySource !== "missing",
  };
}

export function buildReleasePlan({
  repoRoot,
  productName,
  version,
  commit,
  timestamp,
  buildId = "unknown",
  noLegacyCopy = false,
  updaterSigningPlan = detectUpdaterSigningPlan(),
} = {}) {
  if (!repoRoot) {
    throw new Error("repoRoot is required");
  }

  const artifactNames = buildReleaseArtifactNames({
    productName,
    version,
    commit,
  });
  const releaseDir = joinTargetPath(repoRoot, "release", `${timestamp}_v${version}_${commit}`);
  const portableTarget = joinTargetPath(releaseDir, artifactNames.portableName);
  const setupTarget = joinTargetPath(releaseDir, artifactNames.setupName);
  const latestPointerPath = joinTargetPath(repoRoot, "LATEST_RELEASE_POINTER.txt");
  const openPortableInfoPath = joinTargetPath(releaseDir, "OPEN_THIS_PORTABLE.txt");

  return {
    artifactNames,
    latestPointerPath,
    openPortableInfoPath,
    pointerEntries: [
      `latest_release_dir=${releaseDir}`,
      `portable_exe=${portableTarget}`,
      `setup_exe=${setupTarget}`,
      `build_id=${buildId}`,
      `legacy_copy=${noLegacyCopy ? "False" : "True"}`,
    ],
    portableTarget,
    releaseDir,
    setupTarget,
    dryRunSummary: {
      legacyCopy: noLegacyCopy ? "disabled" : "enabled",
      updaterArtifacts: updaterSigningPlan.updaterArtifactsEnabled ? "enabled" : "disabled",
      updaterKeySource: updaterSigningPlan.keySource,
    },
  };
}

function main() {
  const payload = buildReleasePlan({
    buildId: process.env.FLASHCARDS_RELEASE_BUILD_ID || "unknown",
    commit: process.env.FLASHCARDS_RELEASE_COMMIT,
    noLegacyCopy: process.env.FLASHCARDS_RELEASE_NO_LEGACY === "1",
    productName: process.env.FLASHCARDS_RELEASE_PRODUCT_NAME,
    repoRoot: process.env.FLASHCARDS_RELEASE_REPO_ROOT,
    timestamp: process.env.FLASHCARDS_RELEASE_TIMESTAMP,
    updaterSigningPlan: {
      defaultKeyPath: process.env.FLASHCARDS_RELEASE_DEFAULT_KEY_PATH || "",
      keySource: process.env.FLASHCARDS_RELEASE_KEY_SOURCE || "missing",
      shouldLoadDefaultKey: process.env.FLASHCARDS_RELEASE_KEY_SOURCE === "local-default",
      updaterArtifactsEnabled: process.env.FLASHCARDS_RELEASE_UPDATER_ENABLED === "1",
    },
    version: process.env.FLASHCARDS_RELEASE_VERSION,
  });

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedPath === currentModulePath) {
  main();
}
