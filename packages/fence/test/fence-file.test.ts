import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FENCE_CLASSES,
  FenceError,
  fenceFileSchema,
  loadFenceFile,
  locateFenceRoot,
  parseFenceFile,
  serializeFenceFile,
} from "../src/fence-file.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-fence-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const VALID = {
  version: 1,
  allow: ["docs/generated/README.md"],
  entries: [
    {
      path: "pnpm-lock.yaml",
      class: "lockfile",
      reason: "derived: lockfile basename",
    },
    {
      path: "dist/**",
      class: "build-output",
      reason: "derived: build-output dir on disk",
      mode: "deny",
    },
  ],
};

describe("fence schema", () => {
  it("pins the class enum declaration order (append-only contract)", () => {
    expect(FENCE_CLASSES).toEqual([
      "lockfile",
      "build-output",
      "codegen-header",
      "linguist-generated",
      "vendored",
    ]);
  });
  it("accepts a valid file and rejects unknown keys (.strict())", () => {
    expect(parseFenceFile(VALID).entries).toHaveLength(2);
    expect(() => parseFenceFile({ ...VALID, extra: 1 })).toThrow(FenceError);
    expect(() =>
      parseFenceFile({
        ...VALID,
        entries: [{ ...VALID.entries[0], why: "x" }],
      }),
    ).toThrow(FenceError);
  });
  it("rejects bracket globs, over-long globs, and over-cap entry counts loudly", () => {
    expect(() =>
      parseFenceFile({
        version: 1,
        entries: [{ path: "[sS]ecrets/**", class: "vendored", reason: "r" }],
      }),
    ).toThrow(FenceError);
    expect(() =>
      parseFenceFile({
        version: 1,
        entries: [{ path: "a".repeat(257), class: "vendored", reason: "r" }],
      }),
    ).toThrow(FenceError);
    const entries = Array.from({ length: 513 }, (_, i) => ({
      path: `gen/${i}.ts`,
      class: "codegen-header",
      reason: "r",
    }));
    expect(() => parseFenceFile({ version: 1, entries })).toThrow(FenceError);
  });
  it("serialize is stable: entries sorted by path, idempotent round-trip", () => {
    const shuffled = parseFenceFile({
      version: 1,
      entries: [VALID.entries[1], VALID.entries[0]],
    });
    const once = serializeFenceFile(shuffled);
    expect(once.indexOf("dist/**")).toBeLessThan(once.indexOf("pnpm-lock.yaml")); // "d" < "p"
    expect(serializeFenceFile(parseFenceFile(fenceFileSchema.parse(shuffled)))).toBe(once);
  });
});

describe("loadFenceFile / locateFenceRoot", () => {
  it("returns null when fence.yaml is absent, throws FenceError on invalid yaml", () => {
    expect(loadFenceFile(root)).toBeNull();
    writeFileSync(join(root, "fence.yaml"), "{{{{");
    expect(() => loadFenceFile(root)).toThrow(FenceError);
  });
  it("walks up to the nearest fence.yaml", () => {
    writeFileSync(join(root, "fence.yaml"), serializeFenceFile(parseFenceFile(VALID)));
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    expect(locateFenceRoot(join(root, "src", "deep"))).toBe(root);
  });
  it("never walks above the first .git-bearing dir (inclusive)", () => {
    // fence.yaml OUTSIDE the repo boundary must not inject a fence (spec §Security).
    writeFileSync(join(root, "fence.yaml"), serializeFenceFile(parseFenceFile(VALID)));
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    mkdirSync(join(root, "repo", "src"), { recursive: true });
    expect(locateFenceRoot(join(root, "repo", "src"))).toBeNull();
  });
});
