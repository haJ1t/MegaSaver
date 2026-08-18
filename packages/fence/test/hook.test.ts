import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateFenceForWrite } from "../src/hook.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "megasaver-fencehookpkg-"));
  mkdirSync(join(repo, ".git"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const YAML = [
  "version: 1",
  "entries:",
  "  - path: pnpm-lock.yaml",
  "    class: lockfile",
  '    reason: "derived: lockfile basename"',
  "",
].join("\n");

describe("evaluateFenceForWrite", () => {
  it("no fence.yaml → none; fenced path → warn with text; absolute and relative agree", () => {
    expect(
      evaluateFenceForWrite({ cwd: repo, filePath: "pnpm-lock.yaml" }),
    ).toEqual({ kind: "none" });
    writeFileSync(join(repo, "fence.yaml"), YAML);
    const abs = evaluateFenceForWrite({
      cwd: repo,
      filePath: join(repo, "pnpm-lock.yaml"),
    });
    const rel = evaluateFenceForWrite({
      cwd: repo,
      filePath: "pnpm-lock.yaml",
    });
    expect(abs.kind).toBe("warn");
    expect(rel).toEqual(abs);
    if (abs.kind !== "warn") throw new Error("unreachable");
    expect(abs.relPath).toBe("pnpm-lock.yaml");
    expect(abs.text).toContain("mega fence allow pnpm-lock.yaml");
  });
  it("fail-open: unparsable fence.yaml → none; path outside fence root → none", () => {
    writeFileSync(join(repo, "fence.yaml"), "{{{{");
    expect(
      evaluateFenceForWrite({ cwd: repo, filePath: "pnpm-lock.yaml" }),
    ).toEqual({ kind: "none" });
    writeFileSync(join(repo, "fence.yaml"), YAML);
    expect(
      evaluateFenceForWrite({
        cwd: repo,
        filePath: join(tmpdir(), "elsewhere.txt"),
      }),
    ).toEqual({ kind: "none" });
  });
});
