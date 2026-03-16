import fs from "fs";
import path from "path";

const DIST_DIR = "dist";
const DIST_BUILD_INFO_PATH = path.join(DIST_DIR, "src", "generated", "build-info.js");

function readAppVersion() {
  const tauriConfigPath = path.join("src-tauri", "tauri.conf.json");
  try {
    const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
    if (typeof config.version === "string" && config.version.trim().length > 0) {
      return config.version.trim();
    }
  } catch {
    // fall through to unknown
  }
  return "unknown";
}

function resolveGitDir() {
  const gitPath = ".git";
  if (!fs.existsSync(gitPath)) {
    return null;
  }

  const gitStat = fs.statSync(gitPath);
  if (gitStat.isDirectory()) {
    return gitPath;
  }

  const pointerRaw = fs.readFileSync(gitPath, "utf8").trim();
  const pointerMatch = pointerRaw.match(/^gitdir:\s*(.+)$/i);
  if (!pointerMatch) {
    return null;
  }

  return path.resolve(pointerMatch[1].trim());
}

function resolveHeadHash(gitDir) {
  const headPath = path.join(gitDir, "HEAD");
  if (!fs.existsSync(headPath)) {
    return null;
  }

  const headRaw = fs.readFileSync(headPath, "utf8").trim();
  if (/^[0-9a-f]{40}$/i.test(headRaw)) {
    return headRaw;
  }

  const refMatch = headRaw.match(/^ref:\s*(.+)$/i);
  if (!refMatch) {
    return null;
  }

  const refName = refMatch[1].trim();
  const refPath = path.join(gitDir, refName.replace(/\//g, path.sep));
  if (fs.existsSync(refPath)) {
    return fs.readFileSync(refPath, "utf8").trim();
  }

  const packedRefsPath = path.join(gitDir, "packed-refs");
  if (fs.existsSync(packedRefsPath)) {
    const packedLines = fs.readFileSync(packedRefsPath, "utf8").split(/\r?\n/);
    for (const line of packedLines) {
      if (!line || line.startsWith("#") || line.startsWith("^")) continue;
      const [hash, name] = line.split(" ");
      if (name === refName && /^[0-9a-f]{40}$/i.test(hash || "")) {
        return hash;
      }
    }
  }

  return null;
}

function readGitCommit() {
  try {
    const gitDir = resolveGitDir();
    if (!gitDir) return "nogit";
    const fullHash = resolveHeadHash(gitDir);
    if (!fullHash) return "nogit";
    return fullHash.slice(0, 7);
  } catch {
    return "nogit";
  }
}

function makeBuildInfo() {
  const version = readAppVersion();
  const commit = readGitCommit();
  const builtAt = new Date().toISOString();
  const buildId = `${version}-${commit}-${builtAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  return {
    version,
    commit,
    builtAt,
    buildId,
    source: "dist-snapshot",
  };
}

if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}

fs.mkdirSync(DIST_DIR);
fs.copyFileSync("index.html", path.join(DIST_DIR, "index.html"));

if (fs.existsSync("src")) {
  fs.cpSync("src", path.join(DIST_DIR, "src"), { recursive: true });
}

if (fs.existsSync("data")) {
  fs.cpSync("data", path.join(DIST_DIR, "data"), { recursive: true });
}

const buildInfo = makeBuildInfo();
const buildInfoScript = `window.__BUILD_INFO__ = Object.freeze(${JSON.stringify(buildInfo, null, 2)});\n`;

fs.mkdirSync(path.dirname(DIST_BUILD_INFO_PATH), { recursive: true });
fs.writeFileSync(DIST_BUILD_INFO_PATH, buildInfoScript, "utf8");
fs.writeFileSync(path.join(DIST_DIR, "build-metadata.json"), `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(DIST_DIR, "build-id.txt"), `${buildInfo.buildId}\n`, "utf8");

console.log(`Build complete. Build ID: ${buildInfo.buildId}`);
