import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firewallLogPath } from "@megasaver/context-gate";
import { loadFenceFile } from "@megasaver/fence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFenceAllow } from "../../src/commands/fence/allow.js";
import { runFenceCheck } from "../../src/commands/fence/check.js";
import { runFenceStatus } from "../../src/commands/fence/status.js";

let repo: string;
let store: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "megasaver-fencetest-"));
  store = mkdtempSync(join(tmpdir(), "megasaver-store-"));
  mkdirSync(join(repo, ".git"));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

const FENCE_YAML = [
  "# custom comment",
  "version: 1",
  "allow:",
  "  - docs/generated/README.md",
  "entries:",
  "  - path: pnpm-lock.yaml",
  "    class: lockfile",
  '    reason: "derived: lockfile basename"',
  "  - path: dist/**",
  "    class: build-output",
  '    reason: "derived: build-output dir on disk"',
  "    mode: deny",
  "",
].join("\n");

describe("mega fence allow", () => {
  it("appends to allow list and preserves existing comments", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const stdout: string[] = [];
    const code = await runFenceAllow({
      cwd: repo,
      path: "pnpm-lock.yaml",
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const after = readFileSync(join(repo, "fence.yaml"), "utf8");
    expect(after).toContain("# custom comment");
    expect(after).toContain("pnpm-lock.yaml");
    const loaded = loadFenceFile(repo);
    expect(loaded?.allow).toContain("pnpm-lock.yaml");
  });

  it("is idempotent: already allowed prints note, exits 0, leaves file untouched", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const stdout: string[] = [];
    const code = await runFenceAllow({
      cwd: repo,
      path: "docs/generated/README.md",
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("already allowed");
    expect(readFileSync(join(repo, "fence.yaml"), "utf8")).toBe(FENCE_YAML);
  });

  it("fails if fence.yaml is missing", async () => {
    const stderr: string[] = [];
    const code = await runFenceAllow({
      cwd: repo,
      path: "dist/**",
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("no fence.yaml found");
  });
});

describe("mega fence status", () => {
  it("happy path reports root, class counts, warn/deny counts", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const stdout: string[] = [];
    const code = await runFenceStatus({
      cwd: repo,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const out = stdout.join("\n");
    expect(out).toContain("fence root:");
    expect(out).toContain("allow entries: 1");
    expect(out).toContain("total entries: 2 (warn: 1, deny: 1)");
    expect(out).toContain("lockfile: 1");
    expect(out).toContain("build-output: 1");
  });

  it("status on corrupt file exits 1 with error message", async () => {
    writeFileSync(join(repo, "fence.yaml"), "{{{{");
    const stderr: string[] = [];
    const code = await runFenceStatus({
      cwd: repo,
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("fence.yaml is invalid");
  });
});

describe("mega fence check", () => {
  it("returns exit 0 for allowed path, exit 1 for fenced path", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const stdout: string[] = [];
    const codeAllowed = await runFenceCheck({
      cwd: repo,
      path: "src/app.ts",
      json: false,
      storeFlag: store,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(codeAllowed).toBe(0);

    const codeFenced = await runFenceCheck({
      cwd: repo,
      path: "pnpm-lock.yaml",
      json: false,
      storeFlag: store,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(codeFenced).toBe(1);
    expect(stdout.join("\n")).toContain("Generated-File Fence");
  });

  it("--json emits structured result", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const stdout: string[] = [];
    const code = await runFenceCheck({
      cwd: repo,
      path: "dist/bundle.js",
      json: true,
      storeFlag: store,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout[0]!);
    expect(parsed).toMatchObject({
      path: "dist/bundle.js",
      verdict: "deny",
      class: "build-output",
      reason: "derived: build-output dir on disk",
    });
  });

  it("check on a fenced path appends one ledger row to firewall log", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    await runFenceCheck({
      cwd: repo,
      path: "pnpm-lock.yaml",
      json: false,
      storeFlag: store,
      stdout: () => {},
      stderr: () => {},
    });
    const log = readFileSync(firewallLogPath(store), "utf8").trim();
    const parsed = JSON.parse(log);
    expect(parsed).toMatchObject({
      kind: "fence-warn",
      detector: "fence:lockfile",
      sourcePath: "pnpm-lock.yaml",
    });
  });
});
