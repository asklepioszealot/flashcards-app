import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function readAppVersion() {
  const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  try {
    const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
    if (typeof config.version === "string" && config.version.trim()) {
      return config.version.trim();
    }
  } catch {
    // fall through to unknown
  }
  return "unknown";
}

function resolveGitDir() {
  const gitPath = path.join(repoRoot, ".git");
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

  return path.resolve(repoRoot, pointerMatch[1].trim());
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
  if (!fs.existsSync(packedRefsPath)) {
    return null;
  }

  for (const line of fs.readFileSync(packedRefsPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [hash, name] = line.split(" ");
    if (name === refName && /^[0-9a-f]{40}$/i.test(hash || "")) {
      return hash;
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
    source: "vite",
  };
}

function readLocalRuntimeConfig() {
  const localConfigPath = path.join(repoRoot, "runtime-config.local.json");
  if (!fs.existsSync(localConfigPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(localConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readEnvValue(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function makeRuntimeConfig(env = process.env) {
  if (env.FORCE_MOCK_AUTH === "1") {
    return {
      supabaseUrl: "",
      supabaseAnonKey: "",
      authMode: "mock",
      enableDemoAuth: env.ENABLE_DEMO_AUTH !== "0",
      driveClientId: "",
      driveApiKey: "",
      driveAppId: "",
    };
  }

  const localRuntimeConfig = readLocalRuntimeConfig();
  const supabaseUrl =
    readEnvValue(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"])
    || localRuntimeConfig.supabaseUrl
    || "";
  const supabaseAnonKey =
    readEnvValue(env, [
      "SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
    ])
    || localRuntimeConfig.supabaseAnonKey
    || localRuntimeConfig.supabasePublishableKey
    || "";
  const authMode = supabaseUrl && supabaseAnonKey ? "supabase" : "mock";
  const enableDemoAuth =
    env.ENABLE_DEMO_AUTH != null
      ? env.ENABLE_DEMO_AUTH !== "0"
      : localRuntimeConfig.enableDemoAuth !== false;

  const driveClientId = env.DRIVE_CLIENT_ID || localRuntimeConfig.driveClientId || "";
  const driveApiKey = env.DRIVE_API_KEY || localRuntimeConfig.driveApiKey || "";
  const driveAppId = env.DRIVE_APP_ID || localRuntimeConfig.driveAppId || "";

  return {
    supabaseUrl,
    supabaseAnonKey,
    authMode,
    enableDemoAuth,
    driveClientId,
    driveApiKey,
    driveAppId,
  };
}

function emitStaticArtifacts() {
  return {
    name: "flashcards-static-artifacts",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: ".nojekyll",
        source: "",
      });

      const cnamePath = path.join(repoRoot, "CNAME");
      if (fs.existsSync(cnamePath)) {
        this.emitFile({
          type: "asset",
          fileName: "CNAME",
          source: fs.readFileSync(cnamePath, "utf8"),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = {
    ...process.env,
    ...loadEnv(mode, repoRoot, ""),
  };
  const buildInfo = makeBuildInfo();
  const runtimeConfig = makeRuntimeConfig(env);

  return {
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    define: {
      __BUILD_INFO__: JSON.stringify(buildInfo),
      __APP_CONFIG__: JSON.stringify(runtimeConfig),
    },
    plugins: [emitStaticArtifacts()],
  };
});
