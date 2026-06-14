import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { encodeWorkspaceKey, workspaceKeySchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertCwdContains,
  resolveWorkspace,
  safeWorkspaceOverlayDir,
} from "../../bridge/workspace-resolver.js";

const KEY = workspaceKeySchema.parse("0123456789abcdef");

describe("resolveWorkspace", () => {
  it("derives workspaceKey, label, and cwd", () => {
    const resolved = resolveWorkspace("/Users/x/p");
    expect(resolved.workspaceKey).toBe(encodeWorkspaceKey("/Users/x/p"));
    expect(resolved.label).toBe("/Users/x/p");
    expect(resolved.cwd).toBe("/Users/x/p");
  });
});

describe("safeWorkspaceOverlayDir", () => {
  it("returns a path inside <storeRoot>/<feature>", () => {
    const dir = safeWorkspaceOverlayDir("/store", "rules", KEY);
    expect(dir).toBe(join("/store", "rules", KEY));
  });

  it("returns null for a traversal-shaped key", () => {
    expect(safeWorkspaceOverlayDir("/store", "rules", "../etc" as never)).toBeNull();
  });

  it("contains the resolved dir within the feature dir", () => {
    const dir = safeWorkspaceOverlayDir("/store", "index", KEY);
    expect(dir?.startsWith(join("/store", "index") + sep)).toBe(true);
  });
});

describe("assertCwdContains", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mega-cwd-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("accepts a target inside cwd", async () => {
    expect(await assertCwdContains(cwd, join(cwd, ".megasaver", "permissions.yaml"))).toBe(true);
  });

  it("rejects a target outside cwd", async () => {
    expect(await assertCwdContains(cwd, "/etc/passwd")).toBe(false);
  });

  it("rejects a traversal target", async () => {
    expect(await assertCwdContains(cwd, join(cwd, "..", "escape"))).toBe(false);
  });
});
