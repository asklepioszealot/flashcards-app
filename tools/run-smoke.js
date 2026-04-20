const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function buildCommandInvocation(command, args, options = {}) {
  const platform = options.platform || process.platform;
  const normalizedArgs = Array.isArray(args) ? args : [];

  if (platform === "win32" && /\.cmd$/i.test(command)) {
    return {
      command: options.comSpec || process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...normalizedArgs],
    };
  }

  return {
    command,
    args: normalizedArgs,
  };
}

function buildSpawnOptions(env = {}) {
  return {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      FORCE_MOCK_AUTH: "1",
      ...env,
    },
  };
}

function run(command, args, env = {}) {
  const invocation = buildCommandInvocation(command, args);
  const result = spawnSync(
    invocation.command,
    invocation.args,
    buildSpawnOptions(env),
  );

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main(argv = process.argv.slice(2)) {
  run(npmCommand, ["run", "build:dist"]);
  run(npxCommand, ["playwright", "test", ...argv]);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCommandInvocation,
  buildSpawnOptions,
  main,
  run,
};
