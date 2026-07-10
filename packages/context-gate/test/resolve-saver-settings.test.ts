import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalFamilyPath, familyKeyFromPath } from "../src/family-identity.js";
import type { GitCommonDirResult } from "../src/git-family.js";
import {
  type ResolverDeps,
  resolveWorkspaceTokenSaverSettings,
} from "../src/resolve-saver-settings.js";
import { writeExactRecord, writeFamilyRecord, writeGlobalDefault } from "../src/saver-store.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-resolve-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const CWD = "/repo";
// A sensitive-volume deps stub; git result is injected per test.
function deps(git: GitCommonDirResult): ResolverDeps {
  return {
    platform: "linux",
    resolveGit: () => git,
    caseModeOf: () => "sensitive",
    realpath: (p) => p,
    readPolicyFloor: () => null,
  };
}

// Compute the family key the resolver will use for a given common dir.
function familyKeyFor(commonDir: string) {
  const { canonicalPath, caseMode } = canonicalFamilyPath(commonDir, "linux", {
    realpathNative: (p) => p,
    caseMode: () => "sensitive",
  });
  return familyKeyFromPath("linux", caseMode, canonicalPath);
}

describe("precedence step 1 — v1-exact wins with no git", () => {
  it("v1-exact enabled wins even inside a repo", () => {
    writeExactRecord(store, encodeWorkspaceKey(CWD), {
      enabled: true,
      mode: "aggressive",
      scope: "exact",
    });
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "ok", commonDir: "/repo/.git" }),
    );
    expect(r.enabled).toBe(true);
    expect(r.mode).toBe("aggressive");
    expect(r.source).toBe("exact");
  });

  it("v1-exact survives a degraded/corrupt git resolution", () => {
    writeExactRecord(store, encodeWorkspaceKey(CWD), {
      enabled: false,
      mode: "safe",
      scope: "exact",
    });
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "degraded", reason: "metadata_invalid" }),
    );
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("exact");
  });
});

describe("precedence step 4 — family ok", () => {
  it("a family record wins", () => {
    const fk = familyKeyFor("/repo/.git");
    writeFamilyRecord(store, fk.key, {
      enabled: true,
      mode: "balanced",
      identityDigest: fk.digestHex,
      identityPath: fk.identityPath,
    });
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "ok", commonDir: "/repo/.git" }),
    );
    expect(r.enabled).toBe(true);
    expect(r.mode).toBe("balanced");
    expect(r.source).toBe("repository");
    expect(r.repositoryFamilyKey).toBe(fk.key);
  });

  it("falls to the legacy-root record (canonical main-root key) when no family record", () => {
    // Legacy enable written at the canonical main root /repo.
    writeLegacy(store, encodeWorkspaceKey("/repo"), true, "safe");
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "ok", commonDir: "/repo/.git" }),
    );
    expect(r.enabled).toBe(true);
    expect(r.mode).toBe("safe");
    expect(r.source).toBe("legacy-root");
  });

  it("family disable outranks a legacy-root enabled record", () => {
    const fk = familyKeyFor("/repo/.git");
    writeFamilyRecord(store, fk.key, {
      enabled: false,
      mode: "safe",
      identityDigest: fk.digestHex,
      identityPath: fk.identityPath,
    });
    writeLegacy(store, encodeWorkspaceKey("/repo"), true, "aggressive");
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "ok", commonDir: "/repo/.git" }),
    );
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("repository");
  });

  it("falls to the global default when no family or legacy-root record", () => {
    writeGlobalDefault(store, { enabled: true, mode: "balanced" });
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "ok", commonDir: "/repo/.git" }),
    );
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("global");
  });

  it("disabled when nothing matches", () => {
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "ok", commonDir: "/repo/.git" }),
    );
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("missing");
  });
});

describe("precedence — not_git", () => {
  it("applies a legacy-unversioned exact record as exact", () => {
    writeLegacy(store, encodeWorkspaceKey(CWD), true, "aggressive");
    const r = resolveWorkspaceTokenSaverSettings(store, CWD, deps({ kind: "not_git" }));
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("exact");
  });

  it("falls to global default with no legacy record", () => {
    writeGlobalDefault(store, { enabled: true, mode: "safe" });
    const r = resolveWorkspaceTokenSaverSettings(store, CWD, deps({ kind: "not_git" }));
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("global");
  });
});

describe("precedence — degraded", () => {
  it("a legacy-unversioned record present fails closed to disabled", () => {
    writeLegacy(store, encodeWorkspaceKey(CWD), true, "aggressive");
    writeGlobalDefault(store, { enabled: true, mode: "safe" }); // must NOT be used
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "degraded", reason: "budget_exceeded" }),
    );
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("invalid");
    expect(r.familyUnavailableReason).toBe("budget_exceeded");
  });

  it("no legacy record → global default applies", () => {
    writeGlobalDefault(store, { enabled: true, mode: "balanced" });
    const r = resolveWorkspaceTokenSaverSettings(
      store,
      CWD,
      deps({ kind: "degraded", reason: "reciprocal_mismatch" }),
    );
    expect(r.enabled).toBe(true);
    expect(r.source).toBe("global");
    expect(r.familyUnavailableReason).toBe("reciprocal_mismatch");
  });
});

describe("malformed exact record", () => {
  it("fails closed to disabled", () => {
    const dir = join(store, "stats", encodeWorkspaceKey(CWD));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "workspace-token-saver.json"), "{bad");
    const r = resolveWorkspaceTokenSaverSettings(store, CWD, deps({ kind: "not_git" }));
    expect(r.enabled).toBe(false);
    expect(r.source).toBe("invalid");
  });
});

describe("D19 policy floor clamp", () => {
  it("clamps an aggressive exact record to the balanced floor", () => {
    writeExactRecord(store, encodeWorkspaceKey(CWD), {
      enabled: true,
      mode: "aggressive",
      scope: "exact",
    });
    const r = resolveWorkspaceTokenSaverSettings(store, CWD, {
      ...deps({ kind: "ok", commonDir: "/repo/.git" }),
      readPolicyFloor: () => "balanced",
    });
    expect(r.enabled).toBe(true);
    expect(r.mode).toBe("balanced");
    expect(r.policyClamp).toEqual({ floor: "balanced", original: "aggressive" });
  });

  it("no floor -> resolution unchanged, policyClamp null", () => {
    writeExactRecord(store, encodeWorkspaceKey(CWD), {
      enabled: true,
      mode: "aggressive",
      scope: "exact",
    });
    const r = resolveWorkspaceTokenSaverSettings(store, CWD, {
      ...deps({ kind: "ok", commonDir: "/repo/.git" }),
      readPolicyFloor: () => null,
    });
    expect(r.mode).toBe("aggressive");
    expect(r.policyClamp).toBeNull();
  });

  it("floor at/below the record mode -> no clamp mark", () => {
    writeExactRecord(store, encodeWorkspaceKey(CWD), {
      enabled: true,
      mode: "safe",
      scope: "exact",
    });
    const r = resolveWorkspaceTokenSaverSettings(store, CWD, {
      ...deps({ kind: "ok", commonDir: "/repo/.git" }),
      readPolicyFloor: () => "balanced",
    });
    expect(r.mode).toBe("safe");
    expect(r.policyClamp).toBeNull();
  });

  it("a disabled resolution is never clamped", () => {
    // no record at all -> disabled/missing; floor must not flip it on
    const r = resolveWorkspaceTokenSaverSettings(store, CWD, {
      ...deps({ kind: "ok", commonDir: "/repo/.git" }),
      readPolicyFloor: () => "safe",
    });
    expect(r.enabled).toBe(false);
    expect(r.policyClamp).toBeNull();
  });
});

// Helpers.
function writeLegacy(storeRoot: string, wk: string, enabled: boolean, mode: string): void {
  const dir = join(storeRoot, "stats", wk);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workspace-token-saver.json"), JSON.stringify({ enabled, mode }));
}
