import { describe, expect, it } from "vitest";
import {
  MAX_REFS_PER_EDIT,
  PACKAGE_SCAN_CAP,
  classifyPackageEdit,
  extractPackageRefs,
} from "../src/package-refs.js";

const npmSource = { kind: "source", ecosystem: "npm" } as const;
const pySource = { kind: "source", ecosystem: "pypi" } as const;
const npmManifest = { kind: "manifest", ecosystem: "npm" } as const;
const pyManifest = { kind: "manifest", ecosystem: "pypi" } as const;

describe("classifyPackageEdit", () => {
  it.each([
    ["/repo/src/app.ts", npmSource],
    ["/repo/src/App.tsx", npmSource],
    ["/repo/lib/util.mjs", npmSource],
    ["/repo/lib/legacy.cjs", npmSource],
    ["/repo/tools/gen.py", pySource],
    ["/repo/package.json", npmManifest],
    ["/repo/api/requirements.txt", pyManifest],
    ["/repo/api/requirements-dev.txt", pyManifest],
  ] as const)("classifies %s", (path, expected) => {
    expect(classifyPackageEdit(path)).toEqual(expected);
  });
  it.each(["/repo/Cargo.toml", "/repo/go.mod", "/repo/README.md", "/repo/nb.ipynb"])(
    "returns null for %s (v1 scope: npm + PyPI)",
    (path) => expect(classifyPackageEdit(path)).toBeNull(),
  );
});

describe("extractPackageRefs — npm source", () => {
  it("extracts static, bare, dynamic and require specifiers; strips subpaths", () => {
    const text = [
      'import { render } from "preact";',
      "import zod from 'zod';",
      'import "reflect-metadata";',
      'export { deep } from "@scope/pkg/deep/path";',
      'const yaml = require("js-yaml");',
      'const lazy = await import("p-limit");',
    ].join("\n");
    expect(extractPackageRefs(npmSource, text)).toEqual([
      { name: "preact", ecosystem: "npm" },
      { name: "zod", ecosystem: "npm" },
      { name: "reflect-metadata", ecosystem: "npm" },
      { name: "@scope/pkg", ecosystem: "npm" },
      { name: "js-yaml", ecosystem: "npm" },
      { name: "p-limit", ecosystem: "npm" },
    ]);
  });
  it("excludes relative, absolute, imports-map, node: and builtin specifiers", () => {
    const text = [
      'import fs from "node:fs";',
      'import path from "path";',
      'import local from "../lib/helper.js";',
      'import abs from "/opt/tool.js";',
      'import mapped from "#internal/registry";',
      'import data from "data:text/plain,hi";',
    ].join("\n");
    expect(extractPackageRefs(npmSource, text)).toEqual([]);
  });
  it("drops grammar-invalid names (npm names are lowercase, <=214 chars)", () => {
    const long = "a".repeat(250);
    const text = `import x from "NotLower";\nimport y from "${long}";`;
    expect(extractPackageRefs(npmSource, text)).toEqual([]);
  });
});

describe("extractPackageRefs — python source", () => {
  it("extracts top-level modules, maps aliases, excludes stdlib and relatives", () => {
    const text = [
      "import requests",
      "from numpy import array",
      "import os",
      "import collections.abc",
      "from . import sibling",
      "from .relative import thing",
      "import cv2",
      "import boto3, botocore",
      "    import shutil",
    ].join("\n");
    expect(extractPackageRefs(pySource, text)).toEqual([
      { name: "requests", ecosystem: "pypi" },
      { name: "numpy", ecosystem: "pypi" },
      { name: "opencv-python", ecosystem: "pypi" },
      { name: "boto3", ecosystem: "pypi" },
      { name: "botocore", ecosystem: "pypi" },
    ]);
  });
  it("excludes __future__ imports (stdlib seed pin, architect m10)", () => {
    const text = "from __future__ import annotations\nimport sys";
    expect(extractPackageRefs(pySource, text)).toEqual([]);
  });
});

describe("extractPackageRefs — manifests", () => {
  it("collects package.json dependency-field keys, skipping local protocols", () => {
    const manifest = JSON.stringify({
      name: "@megasaver/example",
      dependencies: { citty: "^0.1.6", "left-padd": "^1.0.0", shared: "workspace:*" },
      devDependencies: { vitest: "^2.0.0", vendored: "file:../vendored" },
      peerDependencies: { react: ">=18" },
      optionalDependencies: { fsevents: "^2.3.3" },
      scripts: { build: "tsup" },
    });
    expect(extractPackageRefs(npmManifest, manifest)).toEqual([
      { name: "citty", ecosystem: "npm" },
      { name: "left-padd", ecosystem: "npm" },
      { name: "vitest", ecosystem: "npm" },
      { name: "react", ecosystem: "npm" },
      { name: "fsevents", ecosystem: "npm" },
    ]);
  });
  it("returns [] for unparseable package.json", () => {
    expect(extractPackageRefs(npmManifest, "{ not json")).toEqual([]);
  });
  it("parses requirements.txt lines, normalizing per PEP 503", () => {
    const text = [
      "requests==2.32.3",
      "Flask>=3.0",
      "# a comment",
      "-r base.txt",
      "uvicorn[standard]==0.30.1",
      "torch @ https://download.pytorch.org/whl/cpu/torch-2.3.0.whl",
      "",
    ].join("\n");
    expect(extractPackageRefs(pyManifest, text)).toEqual([
      { name: "requests", ecosystem: "pypi" },
      { name: "flask", ecosystem: "pypi" },
      { name: "uvicorn", ecosystem: "pypi" },
      { name: "torch", ecosystem: "pypi" },
    ]);
  });
});

describe("caps", () => {
  it("dedupes and stops at MAX_REFS_PER_EDIT", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `import x from "pkg-${i}";`);
    lines.push('import again from "pkg-0";');
    const refs = extractPackageRefs(npmSource, lines.join("\n"));
    expect(refs).toHaveLength(MAX_REFS_PER_EDIT);
    expect(refs.filter((r) => r.name === "pkg-0")).toHaveLength(1);
  });
  it("never scans past PACKAGE_SCAN_CAP", () => {
    const text = `${" ".repeat(PACKAGE_SCAN_CAP)}import x from "beyond-cap";`;
    expect(extractPackageRefs(npmSource, text)).toEqual([]);
  });
});
