import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ActivationScope,
  readActivationMode,
  resolveActivationScope,
  writeActivation,
} from "../src/activation-scope.js";
import type { ResolverDeps } from "../src/resolve-saver-settings.js";
import { readExactRecord, readFamilyRecord } from "../src/saver-store.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-scope-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const okDeps: ResolverDeps = {
  platform: "linux",
  resolveGit: () => ({ kind: "ok", commonDir: "/repo/.git" }),
  caseModeOf: () => "sensitive",
  realpath: (p) => p,
};
const notGitDeps: ResolverDeps = {
  platform: "linux",
  resolveGit: () => ({ kind: "not_git" }),
  caseModeOf: () => "sensitive",
  realpath: (p) => p,
};

describe("resolveActivationScope", () => {
  it("in a repo → repository scope rooted at the checkout", () => {
    const scope = resolveActivationScope("/repo/wt", false, okDeps);
    expect(scope.kind).toBe("repository");
    if (scope.kind === "repository") {
      expect(scope.root).toBe("/repo");
      expect(scope.key).toMatch(/^gf1_/);
    }
  });

  it("--exact forces exact scope even in a repo", () => {
    const scope = resolveActivationScope("/repo/wt", true, okDeps);
    expect(scope).toEqual({ kind: "exact", workspaceKey: encodeWorkspaceKey("/repo/wt") });
  });

  it("non-Git cwd → exact scope", () => {
    expect(resolveActivationScope("/plain/dir", false, notGitDeps)).toEqual({
      kind: "exact",
      workspaceKey: encodeWorkspaceKey("/plain/dir"),
    });
  });
});

describe("writeActivation + readActivationMode", () => {
  it("round-trips a repository record", () => {
    const scope = resolveActivationScope("/repo/wt", false, okDeps);
    writeActivation(store, scope, true, "aggressive");
    if (scope.kind === "repository") {
      expect(readFamilyRecord(store, scope.key, scope.identityDigest)).toEqual({
        enabled: true,
        mode: "aggressive",
      });
    }
    expect(readActivationMode(store, scope, "safe")).toBe("aggressive");
  });

  it("round-trips an exact record", () => {
    const scope: ActivationScope = { kind: "exact", workspaceKey: encodeWorkspaceKey("/d") };
    writeActivation(store, scope, false, "safe");
    expect(readExactRecord(store, encodeWorkspaceKey("/d"))).toMatchObject({
      kind: "v1-exact",
      enabled: false,
      mode: "safe",
    });
  });
});
