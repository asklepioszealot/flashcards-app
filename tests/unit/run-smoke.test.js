import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildCommandInvocation,
  buildSpawnOptions,
} = require("../../tools/run-smoke.js");

describe("run-smoke", () => {
  it("builds spawn options without shell mode", () => {
    const options = buildSpawnOptions();

    expect(options.shell).toBe(false);
    expect(options.stdio).toBe("inherit");
    expect(options.env.FORCE_MOCK_AUTH).toBe("1");
  });

  it("wraps Windows .cmd commands through cmd.exe without enabling shell mode", () => {
    const invocation = buildCommandInvocation("npm.cmd", ["run", "build:dist"], {
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    });

    expect(invocation).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "build:dist"],
    });
  });
});
