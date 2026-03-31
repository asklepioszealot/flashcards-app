import path from "node:path";
import { fileURLToPath } from "node:url";

export function buildReleaseArtifactNames({ productName, version, commit }) {
  const normalizedProductName = String(productName ?? "").trim();
  const normalizedVersion = String(version ?? "").trim();
  const normalizedCommit = String(commit ?? "").trim();

  if (!normalizedProductName) {
    throw new Error("productName is required");
  }

  if (!normalizedVersion) {
    throw new Error("version is required");
  }

  if (!normalizedCommit) {
    throw new Error("commit is required");
  }

  return {
    portableName: `${normalizedProductName} Portable v${normalizedVersion}_${normalizedCommit}.exe`,
    setupName: `${normalizedProductName} Kurulum v${normalizedVersion}_${normalizedCommit}.exe`,
    legacyPortableName: `${normalizedProductName} Portable.exe`,
    legacySetupName: `${normalizedProductName} Kurulum.exe`,
  };
}

function main() {
  const [productName, version, commit] = process.argv.slice(2);
  const names = buildReleaseArtifactNames({ productName, version, commit });
  process.stdout.write(`${JSON.stringify(names)}\n`);
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedPath === currentModulePath) {
  main();
}
