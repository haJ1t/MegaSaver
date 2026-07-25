import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runOverlayTwoGates, runTwoGates } from "../src/read.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-symlink-gate-"));
  mkdirSync(join(projectRoot, "vault", ".aws"), { recursive: true });
  writeFileSync(join(projectRoot, "vault", ".aws", "credentials"), "aws_secret_access_key = x");
  writeFileSync(join(projectRoot, "ok.txt"), "public");
  // dir symlink: `cfg/credentials` matches no deny glob lexically
  symlinkSync(join(projectRoot, "vault", ".aws"), join(projectRoot, "cfg"));
  // file symlink: `notes.txt` matches no deny glob lexically
  symlinkSync(join(projectRoot, "vault", ".aws", "credentials"), join(projectRoot, "notes.txt"));
});

afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

const registryGate = (path: string) =>
  runTwoGates({ path, projectId: PROJECT_ID, projectRoot, permissions: null });
const overlayGate = (path: string) =>
  runOverlayTwoGates({ path, cwd: projectRoot, permissions: null });

// Symlink creation needs elevation on Windows (EPERM).
const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("two-gate read: secret-path denylist applies to the symlink target", () => {
  it("control: the direct path to the secret is denied", () => {
    for (const gate of [registryGate, overlayGate]) {
      const r = gate(join(projectRoot, "vault", ".aws", "credentials"));
      expect(r).toEqual({ ok: false, code: "path_denied", reason: "secret_path_read" });
    }
  });

  it("denies a directory symlink that resolves into a denylisted directory", () => {
    for (const gate of [registryGate, overlayGate]) {
      expect(gate("cfg/credentials")).toEqual({
        ok: false,
        code: "path_denied",
        reason: "secret_path_read",
      });
    }
  });

  it("denies a plain file symlink whose target is a denylisted file", () => {
    for (const gate of [registryGate, overlayGate]) {
      expect(gate("notes.txt")).toEqual({
        ok: false,
        code: "path_denied",
        reason: "secret_path_read",
      });
    }
  });

  it("still allows an ordinary in-sandbox file", () => {
    for (const gate of [registryGate, overlayGate]) {
      const r = gate("ok.txt");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.absolute).toBe(join(projectRoot, "ok.txt"));
    }
  });
});
