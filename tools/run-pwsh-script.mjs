import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function normalizeWindowsWorkingDirectory(inputPath) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    return inputPath;
  }

  if (inputPath.startsWith("\\\\?\\")) {
    const withoutPrefix = inputPath.slice(4);
    if (/^[A-Za-z]:\\/.test(withoutPrefix)) {
      return withoutPrefix;
    }
  }

  return inputPath;
}

export function buildPwshInvocation({ cwd = process.cwd(), scriptPath, scriptArgs = [] } = {}) {
  if (typeof scriptPath !== "string" || scriptPath.length === 0) {
    throw new Error("scriptPath is required");
  }

  const normalizedCwd = normalizeWindowsWorkingDirectory(cwd);
  const normalizedScriptPath = normalizeWindowsWorkingDirectory(scriptPath);
  const absoluteScriptPath = path.isAbsolute(normalizedScriptPath)
    ? normalizedScriptPath
    : path.resolve(normalizedCwd, normalizedScriptPath);

  return {
    command: "pwsh",
    cwd: normalizedCwd,
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      absoluteScriptPath,
      ...scriptArgs,
    ],
  };
}

function main() {
  const [scriptPath, ...scriptArgs] = process.argv.slice(2);

  if (!scriptPath) {
    console.error("Usage: node ./tools/run-pwsh-script.mjs <script-path> [args...]");
    process.exit(1);
  }

  const invocation = buildPwshInvocation({
    cwd: process.cwd(),
    scriptPath,
    scriptArgs,
  });

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentModule = fileURLToPath(import.meta.url);

if (invokedScript === currentModule) {
  main();
}
