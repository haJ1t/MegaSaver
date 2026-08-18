import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFenceFile } from "../src/fence-file.js";
import {
  appendFenceAllow,
  appendFenceEntries,
  writeFenceFileAtomic,
} from "../src/write.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-fencewrite-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const HAND_WRITTEN = [
  "# our fence — reviewed 2026-08-06",
  "version: 1",
  "allow: []",
  "entries:",
  "  # keep first",
  "  - path: pnpm-lock.yaml",
  "    class: lockfile",
  '    reason: "derived: lockfile basename"',
  "",
].join("\n");

describe("writeFenceFileAtomic & appendFenceEntries", () => {
  it("writeFenceFileAtomic round-trips through loadFenceFile", () => {
    writeFenceFileAtomic(root, {
      version: 1,
      allow: ["docs/**"],
      entries: [
        {
          path: "dist/**",
          class: "build-output",
          reason: "derived: build-output dir on disk",
        },
      ],
    });
    const loaded = loadFenceFile(root);
    expect(loaded).not.toBeNull();
    expect(loaded?.entries[0]?.path).toBe("dist/**");
  });

  it("appendFenceEntries preserves comments and existing formatting", () => {
    writeFileSync(join(root, "fence.yaml"), HAND_WRITTEN);
    appendFenceEntries(root, [
      { path: "vendor/**", class: "vendored", reason: "derived: vendored dir" },
    ]);
    const after = readFileSync(join(root, "fence.yaml"), "utf8");
    expect(after).toContain("# our fence — reviewed 2026-08-06");
    expect(after).toContain("# keep first");
    expect(after).toContain("vendor/**");
    expect(after.indexOf("pnpm-lock.yaml")).toBeLessThan(
      after.indexOf("vendor/**"),
    );
  });

  it("appendFenceAllow preserves comments and appends to allow sequence", () => {
    writeFileSync(join(root, "fence.yaml"), HAND_WRITTEN);
    appendFenceAllow(root, "dist/allowed.js");
    const after = readFileSync(join(root, "fence.yaml"), "utf8");
    expect(after).toContain("# our fence — reviewed 2026-08-06");
    expect(after).toContain("dist/allowed.js");
    const loaded = loadFenceFile(root);
    expect(loaded?.allow).toContain("dist/allowed.js");
  });
});
