import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOverlayTwoGates, runTwoGates } from "../src/read.js";

// Spec: docs/superpowers/specs/2026-07-25-secret-path-home-credentials-design.md
// `resolveSafeReadPath` deliberately admits `homedir()` as a sandbox root, so
// gate 2 passes these files and the LOCKED denylist is the only thing between
// the agent and them. This is the exact shape the reproduction drove; without
// it the fix is asserted only at the unit layer.

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;

const CARRIERS = [
  ".pgpass",
  join(".docker", "config.json"),
  join(".kube", "config"),
  join(".config", "gh", "hosts.yml"),
] as const;

const NEIGHBOURS = [
  join(".kube", "cache", "http", "abc"),
  join(".docker", "daemon.json"),
  join(".config", "gh", "config.yml"),
] as const;

let fakeHome: string;

const write = (root: string, relative: string) => {
  const absolute = join(root, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, "secret", { mode: 0o600 });
  return absolute;
};

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "megasaver-home-creds-"));
  // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
  vi.stubEnv("HOME", fakeHome);
  vi.stubEnv("USERPROFILE", fakeHome);
  for (const relative of [...CARRIERS, ...NEIGHBOURS]) write(fakeHome, relative);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(fakeHome, { recursive: true, force: true });
});

// A project root that is NOT under the fake home, so containment can only come
// from the homedir() sandbox root — which is the point.
const projectRoot = () => tmpdir();

const gates = (path: string) => [
  runTwoGates({ path, projectId: PROJECT_ID, projectRoot: projectRoot(), permissions: null }),
  runOverlayTwoGates({ path, cwd: projectRoot(), permissions: null }),
];

describe("two-gate read: home credential stores are denied at gate 1", () => {
  it("the fake home is the sandbox root these paths resolve under", () => {
    expect(homedir()).toBe(fakeHome);
  });

  it.each(CARRIERS)("denies ~/%s", (relative) => {
    for (const result of gates(join(fakeHome, relative))) {
      expect(result).toEqual({ ok: false, code: "path_denied", reason: "secret_path_read" });
    }
  });

  // Over-correction fence. These sit beside the denied files, are ordinary
  // config, and a directory-level glob would have taken them with it.
  it.each(NEIGHBOURS)("still admits ~/%s", (relative) => {
    for (const result of gates(join(fakeHome, relative))) {
      expect(result.ok).toBe(true);
    }
  });
});
