import { describe, expect, it } from "vitest";
import {
  buildPwshInvocation,
  normalizeWindowsWorkingDirectory,
} from "../../tools/run-pwsh-script.mjs";

describe("run-pwsh-script", () => {
  it("removes the Windows extended path prefix from the working directory", () => {
    expect(normalizeWindowsWorkingDirectory("\\\\?\\D:\\Git Projelerim\\flashcards-app")).toBe(
      "D:\\Git Projelerim\\flashcards-app",
    );
  });

  it("keeps a normal working directory unchanged", () => {
    expect(normalizeWindowsWorkingDirectory("D:\\Git Projelerim\\flashcards-app")).toBe(
      "D:\\Git Projelerim\\flashcards-app",
    );
  });

  it("builds a pwsh invocation with a normalized cwd and absolute script path", () => {
    const invocation = buildPwshInvocation({
      cwd: "\\\\?\\D:\\Git Projelerim\\flashcards-app",
      scriptPath: "./tools/build-release.ps1",
      scriptArgs: ["-NoLegacyCopy"],
    });

    expect(invocation.command).toBe("pwsh");
    expect(invocation.cwd).toBe("D:\\Git Projelerim\\flashcards-app");
    expect(invocation.args).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "D:\\Git Projelerim\\flashcards-app\\tools\\build-release.ps1",
      "-NoLegacyCopy",
    ]);
  });
});
