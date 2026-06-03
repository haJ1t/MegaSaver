import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_FILE,
  MANIFEST_FILE,
  runPostpack,
  runPrepack,
  stripManifest,
} from "../scripts/strip-publish-manifest.mjs";

// R2 guard: the PUBLISHED manifest must carry no build-only devDependencies and
// no @megasaver/* references, while the working-tree manifest is left untouched
// after pack (prepack strips, postpack restores byte-for-byte).

const SOURCE_MANIFEST = {
  name: "@megasaver/cli",
  version: "1.0.1",
  type: "module",
  bin: { mega: "./dist-bundle/mega.mjs" },
  files: ["dist-bundle"],
  scripts: { build: "tsup", prepack: "x", postpack: "y" },
  devDependencies: {
    "@megasaver/core": "workspace:*",
    "@megasaver/shared": "workspace:*",
    citty: "^0.1.6",
    zod: "^3.24.1",
  },
};

describe("stripManifest (R2 transform)", () => {
  it("removes devDependencies entirely", () => {
    const out = stripManifest(SOURCE_MANIFEST);
    expect(out).not.toHaveProperty("devDependencies");
  });

  it("leaves no @megasaver/* dependency reference (own name is exempt)", () => {
    const out = stripManifest(SOURCE_MANIFEST) as Record<string, unknown>;
    for (const key of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const map = (out[key] ?? {}) as Record<string, string>;
      expect(Object.keys(map).filter((k) => k.startsWith("@megasaver/"))).toEqual([]);
    }
  });

  it("preserves the publishable fields (name, version, bin, files)", () => {
    const out = stripManifest(SOURCE_MANIFEST) as typeof SOURCE_MANIFEST;
    expect(out.name).toBe("@megasaver/cli");
    expect(out.version).toBe("1.0.1");
    expect(out.bin).toEqual({ mega: "./dist-bundle/mega.mjs" });
    expect(out.files).toEqual(["dist-bundle"]);
  });

  it("does not mutate its input", () => {
    const input = structuredClone(SOURCE_MANIFEST);
    stripManifest(input);
    expect(input).toEqual(SOURCE_MANIFEST);
  });
});

describe("prepack/postpack round-trip (R2)", () => {
  let dir: string;
  let manifestPath: string;
  let backupPath: string;
  let originalText: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mega-pack-"));
    manifestPath = join(dir, MANIFEST_FILE);
    backupPath = join(dir, BACKUP_FILE);
    originalText = `${JSON.stringify(SOURCE_MANIFEST, null, 2)}\n`;
    writeFileSync(manifestPath, originalText);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prepack strips the manifest and writes a backup", () => {
    runPrepack(dir);
    const packed = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(packed).not.toHaveProperty("devDependencies");
    expect(packed).not.toHaveProperty("dependencies");
    // backup holds the untouched original
    expect(readFileSync(backupPath, "utf8")).toBe(originalText);
  });

  it("postpack restores the manifest byte-for-byte and removes the backup", () => {
    runPrepack(dir);
    runPostpack(dir);
    expect(readFileSync(manifestPath, "utf8")).toBe(originalText);
    expect(() => readFileSync(backupPath, "utf8")).toThrow();
  });

  it("postpack recovers even if the in-between left a blanked manifest", () => {
    runPrepack(dir);
    // simulate an interrupted pack that left the stripped manifest in place
    writeFileSync(manifestPath, "{}\n");
    runPostpack(dir);
    expect(readFileSync(manifestPath, "utf8")).toBe(originalText);
    expect(() => readFileSync(backupPath, "utf8")).toThrow();
  });

  it("prepack restores a stale backup first so it never backs up a stripped manifest", () => {
    runPrepack(dir); // creates backup + strips
    // a prior run crashed before postpack: stale .bak + stripped manifest remain.
    // a second prepack must re-derive the strip from the ORIGINAL, not the stripped copy.
    runPrepack(dir);
    expect(readFileSync(backupPath, "utf8")).toBe(originalText);
    runPostpack(dir);
    expect(readFileSync(manifestPath, "utf8")).toBe(originalText);
  });
});
