import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
//
// The fixture below mirrors the REAL apps/cli/package.json shape (it declares
// both an inlined and an externalized runtime dependency) so these assertions
// cannot pass vacuously; the "real apps/cli manifest" suite then re-runs the
// invariants against the manifest that actually ships.

const SOURCE_MANIFEST = {
  name: "@megasaver/cli",
  version: "1.0.1",
  type: "module",
  bin: { mega: "./dist-bundle/mega.mjs" },
  files: ["dist-bundle"],
  scripts: { build: "tsup", prepack: "x", postpack: "y" },
  dependencies: {
    "fs-ext": "^2.1.1",
    typescript: "^5.7.3",
  },
  optionalDependencies: {
    "@aws-sdk/client-s3": "^3.700.0",
  },
  devDependencies: {
    "@megasaver/core": "workspace:*",
    "@megasaver/shared": "workspace:*",
    citty: "^0.1.6",
    zod: "^3.24.1",
  },
};

const REAL_MANIFEST_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const BUNDLE_CONFIG_PATH = fileURLToPath(new URL("../tsup.bundle.config.ts", import.meta.url));

// Declared properties rather than a bare index signature: under
// noPropertyAccessFromIndexSignature the latter forces bracket access, which
// Biome's useLiteralKeys then flags — naming the two fields we actually read
// satisfies both instead of scattering biome-ignore lines
// ([[workflows/cli-test-pattern]] resolves that conflict in TS's favour).
type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readRealManifest(): PackageManifest {
  return JSON.parse(readFileSync(REAL_MANIFEST_PATH, "utf8"));
}

// The bundle's `external` array is the ground truth for "not inlined". Parsing
// it from source keeps this guard honest when that list changes.
function readBundleExternals(): string[] {
  const source = readFileSync(BUNDLE_CONFIG_PATH, "utf8");
  const match = /^\s*external:\s*\[([\s\S]*?)\]/m.exec(source);
  if (!match?.[1]) {
    throw new Error("could not locate the `external` array in tsup.bundle.config.ts");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1] as string);
}

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

  it("drops dependencies the bundle inlines and keeps the ones it externalizes", () => {
    const out = stripManifest(SOURCE_MANIFEST) as typeof SOURCE_MANIFEST;
    expect(out.dependencies).toEqual({ "fs-ext": "^2.1.1" });
  });

  it("preserves optionalDependencies (externalized, guarded dynamic imports)", () => {
    const out = stripManifest(SOURCE_MANIFEST) as typeof SOURCE_MANIFEST;
    expect(out.optionalDependencies).toEqual({ "@aws-sdk/client-s3": "^3.700.0" });
  });

  it("does not mutate its input", () => {
    const input = structuredClone(SOURCE_MANIFEST);
    stripManifest(input);
    expect(input).toEqual(SOURCE_MANIFEST);
  });
});

describe("stripManifest against the real apps/cli manifest (R2 guard)", () => {
  it("drops typescript — @megasaver/indexer statically imports it, so it is inlined", () => {
    const out = stripManifest(readRealManifest());
    expect(readRealManifest().dependencies).toHaveProperty("typescript");
    expect(out.dependencies ?? {}).not.toHaveProperty("typescript");
  });

  it("keeps fs-ext — a native module the bundle leaves external", () => {
    const out = stripManifest(readRealManifest());
    expect(out.dependencies?.["fs-ext"]).toBe(readRealManifest().dependencies?.["fs-ext"]);
  });

  it("retains exactly the declared dependencies that tsup leaves external", () => {
    const declared = readRealManifest().dependencies ?? {};
    const externals = readBundleExternals();
    const expected = Object.keys(declared).filter((name) => externals.includes(name));

    expect(expected.length).toBeGreaterThan(0);
    expect(Object.keys(stripManifest(readRealManifest()).dependencies ?? {}).sort()).toEqual(
      expected.sort(),
    );
  });

  it("leaves no @megasaver/* reference in any published dependency map", () => {
    // Widened deliberately: this assertion sweeps maps PackageManifest does not
    // name (peer/optional), which is the point — a @megasaver/* entry must not
    // hide in one we forgot to declare.
    const out = stripManifest(readRealManifest()) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const key of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      expect(Object.keys(out[key] ?? {}).filter((n) => n.startsWith("@megasaver/"))).toEqual([]);
    }
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
    const packed = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
    expect(packed).not.toHaveProperty("devDependencies");
    expect(packed.dependencies).toEqual({ "fs-ext": "^2.1.1" });
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
