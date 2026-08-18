import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFenceAllow } from "../../src/commands/fence/allow.js";
import { runFenceInit } from "../../src/commands/fence/init.js";
import { runFenceStatus } from "../../src/commands/fence/status.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mega-fence-json-"));
  execFileSync("git", ["init", "-q", repo]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("mega fence init fallback & --json", () => {
  it("prints 'no fence signals detected' in an empty repo in text mode", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runFenceInit({
      cwd: repo,
      write: false,
      json: false,
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("no fence signals detected");
  });

  it("outputs structured JSON for fence init in an empty repo", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runFenceInit({
      cwd: repo,
      write: false,
      json: true,
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout[0] ?? "{}");
    expect(parsed).toMatchObject({
      entries: [],
      skipped: [],
      written: false,
    });
  });

  it("outputs structured JSON for fence status", async () => {
    // Disabled first
    const stdoutDisabled: string[] = [];
    const codeDisabled = await runFenceStatus({
      cwd: repo,
      json: true,
      stdout: (l) => stdoutDisabled.push(l),
      stderr: () => {},
    });
    expect(codeDisabled).toBe(0);
    const parsedDisabled = JSON.parse(stdoutDisabled[0] ?? "{}");
    expect(parsedDisabled).toMatchObject({ disabled: true });

    // With fence.yaml
    const yaml = [
      "version: 1",
      "allow:",
      "  - docs/README.md",
      "entries:",
      "  - path: pnpm-lock.yaml",
      "    class: lockfile",
      '    reason: "lockfile"',
      "  - path: dist/**",
      "    class: build-output",
      '    reason: "build"',
      "    mode: deny",
      "",
    ].join("\n");
    writeFileSync(join(repo, "fence.yaml"), yaml);

    const stdoutEnabled: string[] = [];
    const codeEnabled = await runFenceStatus({
      cwd: repo,
      json: true,
      stdout: (l) => stdoutEnabled.push(l),
      stderr: () => {},
    });
    expect(codeEnabled).toBe(0);
    const parsedEnabled = JSON.parse(stdoutEnabled[0] ?? "{}");
    expect(parsedEnabled).toMatchObject({
      disabled: false,
      allowCount: 1,
      totalEntries: 2,
      warnCount: 1,
      denyCount: 1,
      classCounts: {
        lockfile: 1,
        "build-output": 1,
      },
    });
  });

  it("outputs structured JSON for fence allow", async () => {
    writeFileSync(
      join(repo, "fence.yaml"),
      "version: 1\nallow: []\nentries: []\n",
    );
    const stdout: string[] = [];
    const code = await runFenceAllow({
      cwd: repo,
      path: "pnpm-lock.yaml",
      json: true,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout[0] ?? "{}");
    expect(parsed).toMatchObject({
      path: "pnpm-lock.yaml",
      status: "allowed",
    });
  });
});
