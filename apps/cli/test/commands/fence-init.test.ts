import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFenceFile } from "@megasaver/fence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFenceInit } from "../../src/commands/fence/init.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "megasaver-fenceinit-"));
  execFileSync("git", ["init", "-q", repo]);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("mega fence init", () => {
  it("dry run prints classes and skipped patterns, writes nothing", async () => {
    writeFileSync(join(repo, "pnpm-lock.yaml"), "lock");
    mkdirSync(join(repo, "dist"));
    mkdirSync(join(repo, "src/gen"), { recursive: true });
    writeFileSync(join(repo, "src/gen/api.ts"), "// @generated\nexport const x = 1;");
    writeFileSync(join(repo, ".gitattributes"), "legacy/[ab].ts linguist-generated\n");
    mkdirSync(join(repo, "vendor"));
    execFileSync("git", ["add", "."], { cwd: repo });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runFenceInit({
      cwd: repo,
      write: false,
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(loadFenceFile(repo)).toBeNull();
    const out = stdout.join("\n");
    expect(out).toContain("pnpm-lock.yaml");
    expect(out).toContain("dist/**");
    expect(out).toContain("legacy/[ab].ts");
  });

  it("--write creates fence.yaml and second run prints no new entries leaving file byte-identical", async () => {
    writeFileSync(join(repo, "pnpm-lock.yaml"), "lock");
    const stdout1: string[] = [];
    const code1 = await runFenceInit({
      cwd: repo,
      write: true,
      stdout: (l) => stdout1.push(l),
      stderr: () => {},
    });
    expect(code1).toBe(0);
    const content1 = readFileSync(join(repo, "fence.yaml"), "utf8");

    const stdout2: string[] = [];
    const code2 = await runFenceInit({
      cwd: repo,
      write: true,
      stdout: (l) => stdout2.push(l),
      stderr: () => {},
    });
    expect(code2).toBe(0);
    expect(stdout2.join("\n")).toContain("no new entries");
    const content2 = readFileSync(join(repo, "fence.yaml"), "utf8");
    expect(content2).toBe(content1);
  });

  it("additive suggest: new signal appends and preserves existing comments", async () => {
    const HAND_WRITTEN = [
      "# custom comments",
      "version: 1",
      "allow: []",
      "entries:",
      "  - path: pnpm-lock.yaml",
      "    class: lockfile",
      '    reason: "derived: lockfile basename"',
      "",
    ].join("\n");
    writeFileSync(join(repo, "fence.yaml"), HAND_WRITTEN);
    mkdirSync(join(repo, "dist"));

    const stdout: string[] = [];
    const code = await runFenceInit({
      cwd: repo,
      write: true,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("suggested additions");
    expect(stdout.join("\n")).toContain("dist/**");

    const after = readFileSync(join(repo, "fence.yaml"), "utf8");
    expect(after).toContain("# custom comments");
    expect(after).toContain("pnpm-lock.yaml");
    expect(after).toContain("dist/**");
  });

  it("corrupt existing fence.yaml exits 1 with stderr message and leaves file untouched", async () => {
    writeFileSync(join(repo, "fence.yaml"), "{{{{");
    const stderr: string[] = [];
    const code = await runFenceInit({
      cwd: repo,
      write: true,
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("fence.yaml");
    expect(readFileSync(join(repo, "fence.yaml"), "utf8")).toBe("{{{{");
  });
});
