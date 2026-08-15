# Package-Hallucination Firewall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn-only PreToolUse layer on agent edits: extract package references from the NEW text of Edit/Write/MultiEdit calls (imports + `package.json`/`requirements.txt` edits), verify offline in three tiers (project-local → committed-seed∪cache → unknown), warn via `additionalContext` with a typosquat hint, record firewall-ledger events, and manage the cache/allowlist through `mega firewall status/refresh/allow`. Spec: `docs/superpowers/specs/2026-08-06-package-hallucination-firewall-design.md`.

**Architecture:** Pure extraction/verification modules land in `@megasaver/context-gate` beside the existing `firewall-ledger.ts` (reused, extended — never a second ledger). The Claude Code payload parsing and warn composition live in `apps/cli/src/hooks/package-firewall-run.ts`, composed into the existing guard hook process as a stage of `composeGuardOutputs` in `apps/cli/src/hooks/guard-run.ts` (the seam shared with generated-file-fence and session-mesh — see Global Constraints) so no second PreToolUse spawn is added; the installed `GUARD_HOOK_MATCHER` (`^(?:Bash|Edit|Write|MultiEdit|NotebookEdit)$`, `packages/connectors/claude-code/src/hook-settings.ts:23`) already covers the edit tools, so no hook-install change. CLI: `commands/firewall.ts` moves to `commands/firewall/index.ts` (guard/ dir precedent) gaining free `status`/`refresh`/`allow` subcommands while the bare Pro audit run stays byte-identical.

**Tech Stack:** TypeScript strict ESM, citty, Zod, Vitest, node:fs/node:path/node:module; packages `@megasaver/context-gate`, `@megasaver/shared` (`withFileLock` from `@megasaver/shared/node`), `@megasaver/cli`. `@megasaver/pro-analytics` is NOT modified — its `FirewallEventInput` union stays closed; isolation happens at the CLI collectors (Task 6).

## Global Constraints

- **Warn-only:** the package firewall never emits `permissionDecision`; only `additionalContext`. A strict-mode Mistake-Firewall deny passes through byte-identical and the package warn is dropped for that call.
- **No network I/O in any hook path.** `fetch` appears ONLY in `apps/cli/src/commands/firewall/refresh.ts`; Task 10's structural test pins this (with a non-vacuity assertion that the probe finds `fetch(` where it must exist).
- **Fail-open:** `buildPackageFirewallText` never throws and contributes `""` on any failure; the hook process always exits 0 (existing `runGuardHookFromProcess` contract, `apps/cli/src/hooks/guard-run.ts:239-252`). Ledger/warned-set writes are best-effort in their own try/catch — a store failure never suppresses the warn.
- **Inert regression gate:** with no package refs in the edit, hook stdout is byte-identical to today.
- **New-text only:** extraction reads `new_string` / `content` / `edits[].new_string`, NEVER `old_string` (the Mistake Firewall's `editText` includes `old_string`; do not reuse it).
- **Linear-time regexes only.** The regex literals in Task 1 are the reviewed set: bounded whitespace runs, single negated-character-class captures bounded `{1,300}`, no adjacent runs over overlapping classes, no `^\s*` under the `m` flag (split lines + `trimStart()` instead — wiki/concepts/redos-case-output-filter). Changing ANY quantifier requires re-running `scripts/package-refs-redos-probe.mjs` (Task 2) and updating the recorded figures.
- **No RegExp built from input** (wiki/concepts/glob-compile-redos): lockfile/manifest probes are delimiter-carrying `includes()` needles or a hand-rolled linear boundary scan.
- Caps are named exported constants (`PACKAGE_SCAN_CAP`, `MAX_REFS_PER_EDIT`, `REGISTRY_CACHE_MAX_NAMES`, `LOCKFILE_READ_CAP_BYTES`, `LOCAL_WALK_MAX_LEVELS`, `WARNED_SET_CAP`, `REFRESH_MAX_NAMES`, `REFRESH_TIMEOUT_MS`) — never inline literals at call sites.
- **F-FW-1 preserved:** ledger `packageName`/`suggestion` are grammar-bounded by the Zod schema; no free text from an edit reaches `firewall/events.jsonl`.
- apps/cli imports only allow-listed `@megasaver/*` packages and NEVER `@megasaver/stats` directly (`apps/cli/test/dependency-graph.test.ts` §3c — `@megasaver/context-gate` is already on the list, line 33).
- **No timing-tight tests:** the single timing assertion is Task 2's ceiling at the shipped cap with `{ retry: 3 }` and ≥100x measured separation (session-hints-redos precedent); all `withFileLock` deadlines in tests ≥ 250 ms; no lower-bound runtime assertions.
- No pnpm catalog exists in this repo — lockfile probes need no `catalog:` indirection handling.
- **Cross-pair seam (wave-2):** guard-run composition goes through ONE seam — `composeGuardOutputs` (structured stage results for mistake-firewall + package-firewall), shared with generated-file-fence (its Task 6) and session-mesh (its Task 9). Whichever pair lands first CREATES the seam; later pairs extend its input with their stage — never a second merge helper (Task 8). ARCHITECT-FOLDED (2026-08-15, M4/m6/m14): mesh (shipped direct, v2.6) stays OUTSIDE the seam — joined at the caller sites with its `\n\n` delimiter; the seam's join is a single `\n`; BOTH joins are pinned by tests. On deny, package text is dropped but mesh stays (today's wire). Likewise the firewall-ledger `kind` enum is extended by APPENDING members, never by rewriting the literal — the fence pair appends `fence-warn`/`fence-deny` to the same enum and pins `.options` order with a tripwire test; whichever pair lands second appends after the existing members and extends the other pair's order-pinning expectation (Task 6).
- ARCHITECT-FOLDED (2026-08-15): B1 — the shipped `firewallCommand` declares `subCommands: { airlock }`, which makes citty throw `E_UNKNOWN_COMMAND` on `--days 7` AND on any new positional; Task 9 removes the block entirely, folds `airlock` into the positional dispatch, and pins a citty-layer regression test. M2 — the collector filter is an explicit 3-way kind narrowing (TS does not narrow through `.includes()`). M3 — tier-1 PyPI gains `<name>.py` / `<name>/__init__.py` existence probes. M5 — `refresh` grammar-validates every name before fetch/cache. m8 — typosquat hints fire at distance 1 only. m9 — cache read-modify-write happens INSIDE `withFileLock`; Windows rename-over-existing handled per the saver-store precedent. m10 — `__future__` is in the curated stdlib list and pinned by a test. m11 — truncated unscoped npm names get the warn but NO typosquat hint.
- Every task: RED before GREEN; run the named test file, then the package suite. Conventional commits (§10), imperative subject ≤ 50 chars, one logical change per commit. Feature runs in a worktree (risk HIGH — no `main` edits).

---

### Task 1: package-reference extraction (`@megasaver/context-gate`)

**Files:**
- `packages/context-gate/src/package-refs.ts` (new)
- `packages/context-gate/src/data/python-stdlib.ts` (new)
- `packages/context-gate/src/data/pypi-import-aliases.ts` (new)
- `packages/context-gate/src/index.ts` (add exports to the existing named-export list)
- `packages/context-gate/test/package-refs.test.ts` (new)

**Interfaces:**

```ts
export type PackageEcosystem = "npm" | "pypi";
export type PackageRef = { readonly name: string; readonly ecosystem: PackageEcosystem };
export type PackageEditKind =
  | { readonly kind: "source"; readonly ecosystem: PackageEcosystem }
  | { readonly kind: "manifest"; readonly ecosystem: PackageEcosystem };
export const PACKAGE_SCAN_CAP = 262_144; // chars scanned per edit
export const MAX_REFS_PER_EDIT = 64;
export function classifyPackageEdit(filePath: string): PackageEditKind | null;
export function extractPackageRefs(edit: PackageEditKind, newText: string): PackageRef[];
export function isValidPackageName(name: string, ecosystem: PackageEcosystem): boolean;
export function normalizePypiName(raw: string): string; // PEP 503: lowercase, [-_.]+ -> "-"
```

- [ ] Write failing test `packages/context-gate/test/package-refs.test.ts` (flat test dir, sibling of `firewall-ledger.test.ts`):

```ts
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
```

- [ ] Run `pnpm --filter @megasaver/context-gate test -- test/package-refs.test.ts` — expect FAIL (module does not exist). RED.
- [ ] Implement `packages/context-gate/src/data/python-stdlib.ts`: `export const PYTHON_STDLIB: ReadonlySet<string> = new Set([...])` with this curated committed list (Task 4's generator expands it to the full `sys.stdlib_module_names`): `os, sys, re, json, math, time, datetime, typing, pathlib, collections, itertools, functools, subprocess, threading, multiprocessing, asyncio, logging, unittest, argparse, dataclasses, enum, abc, io, csv, random, string, shutil, tempfile, glob, pickle, copy, heapq, bisect, queue, socket, ssl, struct, hashlib, hmac, base64, binascii, uuid, urllib, http, email, html, xml, sqlite3, zlib, gzip, tarfile, zipfile, traceback, warnings, inspect, importlib, contextlib, textwrap, secrets, statistics, decimal, fractions, array, signal, select, errno, stat, platform, getpass, configparser, __future__` (architect m10: `__future__` pinned — the most common Python import; add a test asserting `from __future__ import annotations` extracts nothing).
- [ ] Implement `packages/context-gate/src/data/pypi-import-aliases.ts`: `export const PYPI_IMPORT_ALIASES: Readonly<Record<string, string>>` = `{ cv2: "opencv-python", PIL: "pillow", sklearn: "scikit-learn", yaml: "pyyaml", bs4: "beautifulsoup4", dotenv: "python-dotenv", dateutil: "python-dateutil", jwt: "pyjwt", Crypto: "pycryptodome", magic: "python-magic", git: "gitpython", docx: "python-docx", fitz: "pymupdf", serial: "pyserial", websocket: "websocket-client", telegram: "python-telegram-bot" }` (alias lookup happens BEFORE lowercasing — keys are case-sensitive import names).
- [ ] Implement `packages/context-gate/src/package-refs.ts`. The reviewed regex literals (see Global Constraints — do not alter quantifiers without re-probing):

```ts
// Linear by construction: literal keyword anchor, bounded whitespace run, one
// negated-class capture bounded {1,300} that excludes its own delimiters.
const FROM_SPEC = /\bfrom\s{1,32}["']([^"'\r\n]{1,300})["']/g;
const BARE_IMPORT = /\bimport\s{1,32}["']([^"'\r\n]{1,300})["']/g;
const CALL_SPEC = /\b(?:require|import)\s{0,8}\(\s{0,8}["']([^"'\r\n]{1,300})["']\s{0,8}\)/g;
// Python: applied per line AFTER split("\n") + trimStart() — never ^\s* under m
// (wiki/concepts/redos-case-output-filter).
const PY_FROM = /^from\s{1,32}([A-Za-z_][A-Za-z0-9_.]{0,200})\s{1,32}import\b/;
const PY_IMPORT = /^import\s{1,32}([A-Za-z0-9_., ]{1,300})/;
const PY_MODULE = /^[A-Za-z_][A-Za-z0-9_]{0,100}(?:\.[A-Za-z_][A-Za-z0-9_]{0,100}){0,10}$/;
const NPM_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]{0,100}\/)?[a-z0-9~][a-z0-9._~-]{0,213}$/;
const PYPI_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/;
```

  Implementation notes: cap input with `newText.slice(0, PACKAGE_SCAN_CAP)` first. npm specifier → name: reject `.`/`/`/`#`/`data:`/`file:`/`http` prefixes and `node:*`; reject `builtinModules` membership (`import { builtinModules } from "node:module"`); scoped `@a/b/sub` → `@a/b`, unscoped `a/sub` → `a`; validate `NPM_NAME` and total length ≤ 214. Python `import a, b` → split the `PY_IMPORT` capture on `,`, trim, drop ` as x` tails, validate each with `PY_MODULE`, take the segment before the first `.`; apply `PYPI_IMPORT_ALIASES` on the raw import name, else `normalizePypiName`, then validate `PYPI_NAME` and drop `PYTHON_STDLIB` members. `package.json`: `JSON.parse` in try/catch, keys of `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies` whose value does not start with `workspace:`/`file:`/`link:`/`portal:`. `requirements.txt`: per trimmed line, skip empty/`#`/`-` prefixed; name = leading run matching `/^[A-Za-z0-9][A-Za-z0-9._-]{0,98}/`, normalized. Dedupe by `${ecosystem}:${name}` insertion-ordered; stop at `MAX_REFS_PER_EDIT`.
- [ ] Add the new exports to `packages/context-gate/src/index.ts` (same named-export style as the `firewall-ledger.js` block at lines 152–157).
- [ ] Run the test file — PASS. Run `pnpm --filter @megasaver/context-gate test` — package green. GREEN.
- [ ] Commit: `feat(context-gate): extract package refs from edits`

---

### Task 2: ReDoS fence for the import patterns (probe harness + guard test)

Per wiki/concepts/redos-guard-testing and wiki/concepts/redos-growth-ratio-measurement: the committed probe MEASURES growth ratios at n vs 4n (minimise per size, 4x step); CI enforces an absolute ceiling at the shipped cap because ratio assertions went red on windows-latest in this repo (`packages/context-gate/test/session-hints-redos.test.ts:30-46` documents the incident). The growth-ratio instrument lives in the committed harness that regenerates every quoted figure; the ceiling + structural pins live in CI.

**Files:**
- `scripts/package-refs-redos-probe.mjs` (new, committed harness)
- `packages/context-gate/test/package-refs-redos.test.ts` (new)

**Interfaces:** none new — drives the public `extractPackageRefs`.

- [ ] Write `scripts/package-refs-redos-probe.mjs`: imports `extractPackageRefs` from `packages/context-gate/dist/index.js` (build first), runs each adversarial shape at `n = PACKAGE_SCAN_CAP / 4` and `4n = PACKAGE_SCAN_CAP`, 5 samples per size taking the MINIMUM (growth-ratio page: minimise per size, never per ratio), prints `shape, n_ms, 4n_ms, growth_ratio`. Shapes (all delimiter-starved so a superlinear engine must backtrack):

```js
const SHAPES = [
  ["unclosed from-specifier flood", (size) => 'from "a'.repeat(Math.ceil(size / 7)).slice(0, size)],
  ["single repeated word char", (size) => "x".repeat(size)],
  ["unclosed require-call flood", (size) => "require('p".repeat(Math.ceil(size / 10)).slice(0, size)],
  ["quote flood", (size) => '"'.repeat(size)],
];
```

- [ ] Run `pnpm --filter @megasaver/context-gate build && node scripts/package-refs-redos-probe.mjs`. Record the printed figures verbatim into the guard test's header comment. Expect growth ratios ≈ 4x (linear) and per-call cost at the cap in low single-digit ms.
- [ ] Prove the fence catches a revert (the guard test's RED evidence): temporarily change `FROM_SPEC`'s capture to the unbounded overlapping form `([^"']*[\w./-]+)` in `package-refs.ts`, re-run the probe — expect a superlinear ratio (>>4x) and a multi-second cost at the cap. Record those figures in the test comment too, then REVERT the sabotage.
- [ ] Write `packages/context-gate/test/package-refs-redos.test.ts` (session-hints-redos shape):

```ts
import { describe, expect, it } from "vitest";
import { MAX_REFS_PER_EDIT, PACKAGE_SCAN_CAP, extractPackageRefs } from "../src/package-refs.js";

// Figures regenerated by scripts/package-refs-redos-probe.mjs — paste the
// measured table here (bounded vs reverted) before merging. Ceiling placed in
// the measured separation gap, tail-safe, `retry: 3` (session-hints precedent:
// ratios cried wolf on windows-latest; ceilings at the shipped cap did not).
const CEILING_MS = 1_000;
const npmSource = { kind: "source", ecosystem: "npm" } as const;

const elapsed = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  ["an unclosed from-specifier flood", (s) => 'from "a'.repeat(Math.ceil(s / 7)).slice(0, s)],
  ["a single repeated word char", (s) => "x".repeat(s)],
  ["an unclosed require-call flood", (s) => "require('p".repeat(Math.ceil(s / 10)).slice(0, s)],
] as const;

describe("extractPackageRefs — ReDoS regression at the shipped scan cap", () => {
  for (const [label, shape] of SHAPES) {
    it(`scans ${PACKAGE_SCAN_CAP} chars of ${label} under ${CEILING_MS}ms`, { retry: 3 }, () => {
      const input = shape(PACKAGE_SCAN_CAP);
      expect(elapsed(() => extractPackageRefs(npmSource, input))).toBeLessThan(CEILING_MS);
    });
  }
});

describe("structural pins (deterministic halves of the fence)", () => {
  // Pins the {1,300} bound: a 301-char specifier must NOT match. The only
  // bound-preserving regression left is a quantifier widen, which the ceiling
  // catches; together the halves cover both revert paths (session-hints:59-62).
  it("rejects a specifier longer than 300 chars", () => {
    const spec = "a".repeat(301);
    expect(extractPackageRefs(npmSource, `import x from "${spec}";`)).toEqual([]);
  });
  // Non-vacuity (redos-guard-testing: "assert a minimum match count before
  // asserting anything about what a corpus produced").
  it("the adversarial suite is not vacuous: a realistic corpus still extracts", () => {
    const corpus = Array.from({ length: 200 }, (_, i) => `import x${i} from "pkg-${i}";`).join("\n");
    expect(extractPackageRefs(npmSource, corpus)).toHaveLength(MAX_REFS_PER_EDIT);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/context-gate test -- test/package-refs-redos.test.ts` — PASS (fence green over the fixed code; the recorded revert drill above is the RED evidence).
- [ ] Commit: `test(context-gate): fence package-ref extractor`

---

### Task 3: tier-1 local resolver

**Files:**
- `packages/context-gate/src/package-local-resolve.ts` (new)
- `packages/context-gate/src/index.ts` (exports)
- `packages/context-gate/test/package-local-resolve.test.ts` (new)

**Interfaces:**

```ts
export type LocalResolver = { resolves(ref: PackageRef): boolean };
export const LOCAL_WALK_MAX_LEVELS = 12;
export const LOCKFILE_READ_CAP_BYTES = 16 * 1024 * 1024;
export function createLocalResolver(startDir: string): LocalResolver; // memoizes file reads per instance
export function hasTokenBoundaryMatch(text: string, needle: string): boolean; // linear indexOf scan, no RegExp
```

- [ ] Write failing test `packages/context-gate/test/package-local-resolve.test.ts` — `mkdtempSync` fixture roots (`rmSync` in `afterEach`), realistic lockfile snippets:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalResolver, hasTokenBoundaryMatch } from "../src/package-local-resolve.js";

const roots: string[] = [];
function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-local-resolve-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const npm = (name: string) => ({ name, ecosystem: "npm" as const });
const pypi = (name: string) => ({ name, ecosystem: "pypi" as const });

describe("npm tier-1 resolution", () => {
  it("resolves via nearest package.json dependency fields", () => {
    const root = createRoot();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { citty: "^0.1.6" }, devDependencies: { vitest: "^2" } }),
    );
    const r = createLocalResolver(join(root));
    expect(r.resolves(npm("citty"))).toBe(true);
    expect(r.resolves(npm("vitest"))).toBe(true);
    expect(r.resolves(npm("left-padd"))).toBe(false);
  });
  it("resolves via node_modules presence (scoped and unscoped)", () => {
    const root = createRoot();
    mkdirSync(join(root, "node_modules", "@scope", "pkg"), { recursive: true });
    mkdirSync(join(root, "node_modules", "zod"), { recursive: true });
    const r = createLocalResolver(root);
    expect(r.resolves(npm("@scope/pkg"))).toBe(true);
    expect(r.resolves(npm("zod"))).toBe(true);
  });
  it("resolves via pnpm-lock.yaml without matching name prefixes", () => {
    const root = createRoot();
    writeFileSync(
      join(root, "pnpm-lock.yaml"),
      ["lockfileVersion: '9.0'", "packages:", "  /preact@10.19.2:", "    resolution: {integrity: sha512-abc}"].join("\n"),
    );
    const r = createLocalResolver(root);
    expect(r.resolves(npm("preact"))).toBe(true);
    expect(r.resolves(npm("react"))).toBe(false); // "/preact@" must not satisfy "react"
  });
  it("walks up from a nested start dir and stops at the .git level", () => {
    const root = createRoot();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "packages", "app", "src", "deep"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { execa: "^9" } }));
    const r = createLocalResolver(join(root, "packages", "app", "src", "deep"));
    expect(r.resolves(npm("execa"))).toBe(true);
  });
});

describe("pypi tier-1 resolution", () => {
  it("resolves via requirements.txt / pyproject.toml with token boundaries", () => {
    const root = createRoot();
    writeFileSync(join(root, "requirements.txt"), "requests-toolbelt==1.0.0\nnumpy==1.26.4\n");
    writeFileSync(join(root, "pyproject.toml"), '[project]\ndependencies = ["python-dateutil>=2.9"]\n');
    const r = createLocalResolver(root);
    expect(r.resolves(pypi("numpy"))).toBe(true);
    expect(r.resolves(pypi("python-dateutil"))).toBe(true);
    expect(r.resolves(pypi("requests"))).toBe(false); // inside requests-toolbelt: boundary blocks it
  });
  it("matches underscore/hyphen spelling variants (PEP 503)", () => {
    const root = createRoot();
    writeFileSync(join(root, "requirements.txt"), "typing_extensions==4.12.2\n");
    expect(createLocalResolver(root).resolves(pypi("typing-extensions"))).toBe(true);
  });
  it("resolves project-local modules via file probes (architect M3)", () => {
    const root = createRoot();
    mkdirSync(join(root, "mymod"), { recursive: true });
    writeFileSync(join(root, "mymod", "__init__.py"), "");
    writeFileSync(join(root, "utils.py"), "");
    writeFileSync(join(root, "snake_case_helper.py"), "");
    const r = createLocalResolver(root);
    expect(r.resolves(pypi("mymod"))).toBe(true);
    expect(r.resolves(pypi("utils"))).toBe(true);
    expect(r.resolves(pypi("snake-case-helper"))).toBe(true); // _ variant probe
    expect(r.resolves(pypi("requests"))).toBe(false);
  });
});

describe("hasTokenBoundaryMatch", () => {
  it.each([
    ["numpy==1.26", "numpy", true],
    ["requests-toolbelt", "requests", false],
    ["preact@10", "react", false],
    ['deps = ["rich"]', "rich", true],
  ] as const)("(%s, %s) -> %s", (text, needle, expected) => {
    expect(hasTokenBoundaryMatch(text, needle)).toBe(expected);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/context-gate test -- test/package-local-resolve.test.ts` — FAIL. RED.
- [ ] Implement. Walk: from `startDir` upward ≤ `LOCAL_WALK_MAX_LEVELS`, probing each level, stopping AFTER the first level containing `.git` (probe that level too). Per level, memoized reads (Map keyed by absolute path; `readFileSync` in try/catch; skip files whose `statSync().size > LOCKFILE_READ_CAP_BYTES`). npm probes: parsed `package.json` dep-field keys; `existsSync(join(dir, "node_modules", ...name.split("/")))`; delimiter-carrying needles over raw lockfile text — `pnpm-lock.yaml`: `` `/${name}@` ``, `` `'${name}':` ``, `` `"${name}":` ``; `package-lock.json`: `` `"node_modules/${name}"` ``; `yarn.lock`: `` `"${name}@` `` and `` `\n${name}@` ``. pypi probes: `requirements.txt`, `requirements-dev.txt`, `pyproject.toml`, `poetry.lock`, `uv.lock`, `Pipfile`, `Pipfile.lock` via `hasTokenBoundaryMatch` on the normalized name AND its `_` variant (`name.replaceAll("-", "_")`), case-insensitively (lowercase the haystack once, memoized); PLUS project-local file probes per level (architect M3): `existsSync(join(dir, variant + ".py"))` and `existsSync(join(dir, variant, "__init__.py"))` for both `-` and `_` variants, memoized like the other reads. `hasTokenBoundaryMatch`: `indexOf` loop; a hit counts only when the char before and after the match is absent or outside `[A-Za-z0-9._-]`.
- [ ] Run the test file — PASS; package suite green. GREEN.
- [ ] Commit: `feat(context-gate): resolve package refs locally`

---

### Task 4: tier-2 known-registry cache, allowlist, seeds

**Files:**
- `packages/context-gate/src/package-registry-cache.ts` (new)
- `packages/context-gate/src/data/npm-top.ts` (new)
- `packages/context-gate/src/data/pypi-top.ts` (new)
- `scripts/firewall-seed.mjs` (new, committed generator)
- `packages/context-gate/src/index.ts` (exports)
- `packages/context-gate/test/package-registry-cache.test.ts` (new)

**Interfaces:**

```ts
export type AllowlistEntry = { name: string; ecosystem: PackageEcosystem; addedAt: string };
export const REGISTRY_CACHE_MAX_NAMES = 20_000;
export function registryCachePath(storeRoot: string, ecosystem: PackageEcosystem): string; // <root>/firewall/registry-cache/<eco>.json
export function allowlistPath(storeRoot: string): string; // <root>/firewall/allowlist.json
export function readRegistryCache(storeRoot: string, ecosystem: PackageEcosystem): { refreshedAt: string | null; names: string[] }; // fail-open {null, []}
export function readKnownNames(storeRoot: string, ecosystem: PackageEcosystem): ReadonlySet<string>; // seeds ∪ cache
export function appendCachedNames(storeRoot: string, ecosystem: PackageEcosystem, names: readonly string[], nowIso: string): { added: number; total: number; capped: boolean };
export function readAllowlist(storeRoot: string): AllowlistEntry[]; // fail-open []
export function appendAllowlistEntry(storeRoot: string, entry: AllowlistEntry): boolean;
export function isAllowlisted(storeRoot: string, ref: PackageRef): boolean;
```

- [ ] Write failing test `packages/context-gate/test/package-registry-cache.test.ts`: temp store roots; asserts (a) `readKnownNames` includes seed members (`react`, `lodash`, `express`, `left-pad` for npm; `requests`, `numpy` for pypi) with no cache file present; (b) `appendCachedNames` creates `firewall/registry-cache/npm.json`, dedupes against seeds+cache, sorts, sets `refreshedAt`, and re-read round-trips through its Zod schema; (c) append past `REGISTRY_CACHE_MAX_NAMES` returns `capped: true` and does not grow; (d) corrupt cache JSON → `readKnownNames` still returns the seeds (fail-open); (e) `appendAllowlistEntry` + `isAllowlisted` round-trip and grammar-invalid names are rejected; (f) writer leaves no `*.tmp` residue.
- [ ] Run it — FAIL. RED.
- [ ] Implement seeds as committed curated arrays (real names, sorted):
  - `NPM_TOP` (40): `@types/node, axios, chalk, citty, commander, debug, dotenv, esbuild, eslint, execa, express, fastify, glob, inquirer, jest, koa, left-pad, lodash, minimist, mocha, next, node-fetch, ora, prettier, react, react-dom, rollup, rxjs, semver, svelte, tslib, typescript, undici, uuid, vite, vitest, vue, webpack, ws, yargs, zod` — plus `left-pad` guarantees the Task 7 typosquat fixture.
  - `PYPI_TOP` (40): `aiohttp, attrs, beautifulsoup4, boto3, botocore, certifi, charset-normalizer, click, cryptography, django, fastapi, flask, httpx, idna, jinja2, lxml, markupsafe, matplotlib, numpy, opencv-python, packaging, pandas, pillow, pip, pydantic, pytest, python-dateutil, pyyaml, requests, rich, scikit-learn, scipy, setuptools, six, sqlalchemy, tqdm, typing-extensions, urllib3, uvicorn, wheel`.
- [ ] Implement writers with `withFileLock` (`@megasaver/shared/node`, verified signature `withFileLock(lockPath, { deadlineMs, staleMs }, fn): boolean`) around a tmp+`renameSync` atomic write (saver-store precedent `packages/context-gate/src/saver-store.ts:99`); lock options `{ deadlineMs: 250, staleMs: 5_000 }`; lock returns false ⇒ skip write, report `added: 0`. ARCHITECT-FOLDED (m9): the read-modify-write (read existing cache + merge + write) happens ENTIRELY INSIDE the `withFileLock` fn so concurrent refreshes cannot lose updates; Windows rename-over-existing is handled exactly per the saver-store precedent (rename first, then unlink-fallback on failure — CI runs windows-latest). Readers: `existsSync` + `JSON.parse` + Zod `safeParse`, any failure ⇒ fail-open defaults. Zod: cache `{ version: z.literal(1), ecosystem: z.enum(["npm","pypi"]), refreshedAt: z.string(), names: z.array(z.string().max(214)).max(REGISTRY_CACHE_MAX_NAMES) }.strict()`; allowlist `{ version: z.literal(1), entries: z.array(entrySchema).max(2_000) }.strict()` with grammar check via `isValidPackageName`.
- [ ] Write `scripts/firewall-seed.mjs` (dev-time network; regenerates the three data files): npm — page `https://registry.npmjs.org/-/v1/search?text=boost-exact:false&popularity=1.0&size=250&from={0,250,500,750}` collecting `objects[].package.name` (ASSUMPTION: npm search API accepts this pagination; verified at implementation time — on failure the curated seeds stand); pypi — `https://hugovk.github.io/top-pypi-packages/top-pypi-packages-30-days.min.json` top 1000 `rows[].project` (ASSUMPTION: dataset URL stable); python stdlib — the full CPython 3.12 `sys.stdlib_module_names` list embedded in the script. Script validates every name with the Task 1 grammar, merges with the curated arrays, sorts, and rewrites the `data/*.ts` files with a `// generated by scripts/firewall-seed.mjs — do not hand-edit entries` header.
- [ ] Run `node scripts/firewall-seed.mjs` once and commit the expanded data files (offline fallback: curated seeds stand; note it in the PR).
- [ ] Run the test file, then the package suite — GREEN.
- [ ] Commit: `feat(context-gate): known-registry cache + allowlist`

---

### Task 5: typosquat distance hint

**Files:**
- `packages/context-gate/src/package-typosquat.ts` (new)
- `packages/context-gate/src/index.ts` (exports)
- `packages/context-gate/test/package-typosquat.test.ts` (new)

**Interfaces:**

```ts
export function osaDistanceAtMost(a: string, b: string, max: number): number | null; // optimal string alignment; null when > max
export function nearestKnownName(name: string, known: readonly string[]): string | null; // best distance === 1 (architect m8), ties → lexicographic; null when name ∈ known
```

- [ ] Write failing test with realistic squats: `lodahs`→`lodash` (transposition = 1), `reqeusts`→`requests`, `left-padd`→`left-pad`, `expresss`→`express`, `numpyy`→`numpy`; `osaDistanceAtMost("abc","abc",2)` = 0; a distance-2 name (`reqeustss` vs seeds) → `nearestKnownName` null (hints fire at distance 1 only — architect m8); `nearestKnownName("react", NPM_TOP)` → null (known names are never flagged); length-diff > 1 prefilter (`"a"` vs `"aaaa"` → null without scanning).
- [ ] Run — FAIL. RED.
- [ ] Implement banded OSA with early row-abandon:

```ts
export function osaDistanceAtMost(a: string, b: string, max: number): number | null {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return null;
  let prev2: number[] | null = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (prev2 !== null && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2[j - 2] as number) + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return null;
    prev2 = prev;
    prev = cur;
  }
  const d = prev[b.length] as number;
  return d <= max ? d : null;
}
```

  `nearestKnownName`: return null when `known.includes(name)`; scan with the length prefilter (`Math.abs(lenA - lenB) <= 1`), keep the lowest distance === 1 (tie → `localeCompare` winner); distance 0 (exact) and distance ≥ 2 → null (architect m8). Callers pass the SEED arrays only (spec component 4), never the full cache.
- [ ] Run — GREEN; package suite green.
- [ ] Commit: `feat(context-gate): typosquat distance hint`

---

### Task 6: firewall-ledger kinds + CLI reader isolation

**Files:**
- `packages/context-gate/src/firewall-ledger.ts` (extend `firewallEventSchema`; export `PACKAGE_FIREWALL_KINDS`)
- `packages/context-gate/src/index.ts` (export)
- `packages/context-gate/test/firewall-ledger.test.ts` (extend)
- `apps/cli/src/commands/firewall.ts` (filter package kinds at the `safeParse` collector, lines 78-79 — the file Task 9 later moves to `firewall/index.ts`)
- `apps/cli/src/commands/alerts.ts` (same filter at its collector, line 81)
- `apps/cli/test/commands/firewall.test.ts`, `apps/cli/test/commands/alerts.test.ts` (extend)

**Interfaces (extended schema):**

```ts
// firewall-ledger.ts — APPEND the two members to the END of the existing kind
// enum, preserving every member already present. Never rewrite the literal:
// generated-file-fence appends "fence-warn"/"fence-deny" to this same enum and
// pins .options order with a tripwire test — whichever pair lands second
// appends after the other's members and extends that order-pinning
// expectation (append-only, earlier members never move).
kind: z.enum([/* existing members, in place */ "unknown-package", "typosquat-suspect"]),
// F-FW-1: bounded to package-name grammar charset — free text cannot enter the ledger.
packageName: z.string().max(214).regex(/^[@A-Za-z0-9][A-Za-z0-9._/~-]{0,213}$/).optional(),
ecosystem: z.enum(["npm", "pypi"]).optional(),
suggestion: z.string().max(214).regex(/^[@A-Za-z0-9][A-Za-z0-9._/~-]{0,213}$/).optional(),
// Mirror of the fence pair's FENCE_FIREWALL_KINDS — the CLI collectors filter on it.
export const PACKAGE_FIREWALL_KINDS = ["unknown-package", "typosquat-suspect"] as const;
```

`@megasaver/pro-analytics` is NOT modified. `FirewallEventInput` (`packages/pro-analytics/src/firewall-report.ts:5-14`) keeps its CLOSED kind union, and `detectAnomalies` keeps summing every event it is handed into the alerts `firewall` spike axis with no kind filter (`packages/pro-analytics/src/alerts.ts:149-154`) — so isolation happens at the two CLI collectors, exactly as generated-file-fence Task 5 does for its kinds. This keeps `diagnoseFirewall` totals (including the `events: inWindow.length` counter, `firewall-report.ts:78-80`) and the alerts spike axis meaning what they meant before this feature.

- [ ] Extend `firewall-ledger.test.ts` (RED first): an `unknown-package` event `{ at, kind: "unknown-package", detector: "package-firewall", count: 1, packageName: "left-padd", ecosystem: "npm", sessionId: "s-1" }` round-trips `.strict()`; a `typosquat-suspect` event carries `suggestion: "left-pad"`; `packageName: 'import x from "a"'` is REJECTED (grammar); the pre-existing kinds still parse (regression); `PACKAGE_FIREWALL_KINDS` equals `["unknown-package", "typosquat-suspect"]`.
- [ ] Run `pnpm --filter @megasaver/context-gate test -- test/firewall-ledger.test.ts` — FAIL. Implement the schema extension + constant. GREEN.
- [ ] Run `pnpm --filter @megasaver/cli typecheck` — FAIL at the two pro-analytics call sites (`commands/firewall.ts:84`, `commands/alerts.ts:104`): the widened `FirewallEvent` no longer assigns to the closed `FirewallEventInput`. This compile error is the designed tripwire (same as fence Task 5); do NOT fix it by widening pro-analytics.
- [ ] Extend `apps/cli/test/commands/firewall.test.ts` and `apps/cli/test/commands/alerts.test.ts` (RED first): seed a ledger with legacy rows plus `unknown-package`/`typosquat-suspect` rows dated today; run each command twice — with and without the package rows — and assert the emitted output is IDENTICAL (audit report totals including `events`, and the alerts `firewall` axis, unchanged by package-kind rows).
- [ ] Implement the filters: in both CLI collectors, after `result.success`, narrow with an EXPLICIT kind check — TypeScript does not narrow through `KINDS.includes(e.kind)` (architect M2, compile-verified): push into the pro-analytics-typed array only when

```ts
if (result.data.kind === "blocked-read" || result.data.kind === "redacted" || result.data.kind === "observed") {
  events.push(result.data);
}
```

(one `if` per site — 3 similar lines beat an abstraction).
- [ ] Run `pnpm --filter @megasaver/context-gate test`, `pnpm --filter @megasaver/cli test -- test/commands/firewall.test.ts test/commands/alerts.test.ts`, `pnpm typecheck` — GREEN.
- [ ] Commit: `feat(context-gate): package firewall ledger events`

---

### Task 7: hook builder + per-session warned-set

**Files:**
- `apps/cli/src/hooks/package-firewall-run.ts` (new)
- `apps/cli/test/hooks/package-firewall-run.test.ts` (new)

**Interfaces:**

```ts
export type BuildPackageFirewallInput = { payload: unknown; storeRoot: string; now: () => number };
export const WARNED_SET_CAP = 500;
export function warnedSetPath(storeRoot: string, sessionId: string): string; // <root>/firewall/warned/<sessionId>.json
export async function buildPackageFirewallText(input: BuildPackageFirewallInput): Promise<string>; // "" when silent; NEVER throws
```

Warn text (verbatim templates; ≤3 names listed, then `…and N more unknown package(s)`):

```ts
const head = `⛨ Package Firewall: "${name}" (${eco}) is not in this project's dependencies, lockfiles, or the known-registry cache — it may be hallucinated. Verify it exists before installing.`;
const hint = suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
const tail = ` Verify online: mega firewall refresh ${name}. Private registry? mega firewall allow ${name} --ecosystem ${eco}`;
```

- [ ] Write failing test `apps/cli/test/hooks/package-firewall-run.test.ts` (temp store roots per Task 3's fixture pattern; payload shape mirrors `preToolUsePayloadSchema` in `guard-run.ts:27-34`):

```ts
function editPayload(root: string, newString: string, overrides: Record<string, unknown> = {}) {
  return {
    session_id: "s-1234",
    cwd: root,
    tool_name: "Edit",
    tool_input: {
      file_path: join(root, "src", "app.ts"),
      old_string: "// TODO",
      new_string: newString,
      ...overrides,
    },
  };
}
```

  Cases (each asserts on the returned string AND, where noted, on `firewall/events.jsonl` lines parsed with `firewallEventSchema`):
  - unknown npm ref (`import { pad } from "left-padd";`) ⇒ text contains `"left-padd"`, the typosquat hint `Did you mean "left-pad"?`, and both CLI pointers; ledger holds one `unknown-package` and one `typosquat-suspect` event with `packageName: "left-padd"`.
  - same session + same name again ⇒ `""` (warned-set dedupe); a different `session_id` warns again.
  - `appendAllowlistEntry(root, { name: "left-padd", ecosystem: "npm", addedAt })` first ⇒ `""`.
  - tier-1: `mkdirSync(join(root, "node_modules", "left-padd"), { recursive: true })` ⇒ `""`.
  - known seed name (`import React from "react";`) ⇒ `""`.
  - new-text-only: `old_string` containing `import x from "left-padd"` while `new_string` is plain prose ⇒ `""`.
  - Write tool with `content` and a `requirements.txt` path (`reqeusts==2.0`) ⇒ pypi warn with `Did you mean "requests"?`.
  - malformed payload / non-edit tool (`Bash`) / missing `file_path` / `.ipynb` path ⇒ `""`.
  - never-throws: `storeRoot` pointing at a FILE (not dir) still resolves to a string (`await expect(...).resolves.toBeTypeOf("string")`).
- [ ] Run `pnpm --filter @megasaver/cli test -- test/hooks/package-firewall-run.test.ts` — FAIL. RED.
- [ ] Implement: own Zod payload parse (same shape as `preToolUsePayloadSchema` — module-local by design, 3-similar-lines rule); tools `Edit|Write|MultiEdit` only; `classifyPackageEdit(file_path)`; new-text join of `new_string` / `content` / `edits[].new_string`; `extractPackageRefs`; drop refs already in the warned-set (session_id path segment validated `/^[A-Za-z0-9_-]{1,128}$/` — invalid ⇒ skip dedupe, still warn); verify per ref: `isAllowlisted` → `createLocalResolver(dirname(file_path)).resolves` (fallback `cwd` when `file_path` is relative) → `readKnownNames(...).has(name)` → unknown. For unknowns: `nearestKnownName` against the matching seed array; compose text; best-effort `appendFirewallEvent` per unknown (`detector: "package-firewall"`, `count: 1`, `at: new Date(input.now()).toISOString()`, `sessionId`) plus a `typosquat-suspect` event when a suggestion exists; best-effort warned-set write (`withFileLock` `{ deadlineMs: 250, staleMs: 5_000 }` + tmp/rename, cap `WARNED_SET_CAP`). Everything inside one outer try/catch returning `""`.
- [ ] Run the test file — PASS; `pnpm --filter @megasaver/cli test` green. GREEN.
- [ ] Commit: `feat(cli): package firewall PreToolUse warn`

---

### Task 8: compose into the guard hook process (adopt the shared seam)

**Files:**
- `apps/cli/src/hooks/guard-run.ts` (extract `firewallStage`; add `composeGuardOutputs`; wire the package stage into `buildGuardHookOutput`)
- `apps/cli/test/hooks/package-firewall-compose.test.ts` (new)

**Interfaces:**

```ts
// The ONE guard-run composition seam (Global Constraints, cross-pair seam):
// shared with generated-file-fence (its Task 6) and session-mesh (its Task 9).
// Documented stage order INSIDE the seam: mistake-firewall → package-firewall.
// ARCHITECT-FOLDED (M4/m6/m14): mesh (shipped direct, v2.6) stays OUTSIDE the
// seam — joined at the caller sites with its `\n\n` delimiter; the seam's own
// join is a single `\n`; both joins are pinned by tests. On deny, the package
// text is dropped but mesh stays (today's wire).
// Whichever pair lands first CREATES composeGuardOutputs; later pairs extend
// its input with their stage. The stages this pair defines:
export type FirewallStageResult =
  | { kind: "none" }
  | { kind: "warn"; text: string }
  | { kind: "deny"; reason: string };
// Warn-only by contract — the package firewall never denies.
export type PackageFirewallStageResult = { kind: "none" } | { kind: "warn"; text: string };
export function composeGuardOutputs(input: {
  firewall: FirewallStageResult;
  packageFirewall: PackageFirewallStageResult;
}): string; // "" | additionalContext JSON | deny JSON — the ONLY output builder
```

- [ ] Write failing test `apps/cli/test/hooks/package-firewall-compose.test.ts`:
  - `composeGuardOutputs({ firewall: { kind: "none" }, packageFirewall: { kind: "none" } })` ⇒ `""` (inert — hook stdout byte-identical to today).
  - firewall warn + package none ⇒ byte-identical to today's warn JSON (`{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":<text>}}`).
  - firewall none + package warn ⇒ `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"PKG WARN"}}`.
  - firewall deny + package warn ⇒ deny JSON exactly matching the verified wire (current `guard-run.ts:339-356`); the package text appears NOWHERE in the output (dropped — the edit is blocked anyway).
  - firewall warn + package warn ⇒ ONE `additionalContext` equal to `` `${firewallText}\n${pkgText}` `` (single `\n` join — the seam's contract; the fence pair's compose test pins the same join for its stage).
  - MESH VARIANTS (architect M4 — the refactor's highest-risk path, currently untested): (a) package warn + firewall none + mesh text ⇒ `additionalContext` = `PKG WARN\n\n<mesh>` (mesh appended by the CALLER with its `\n\n` join); (b) package warn + firewall warn + mesh ⇒ `${fw}\n${pkg}\n\n${mesh}`; (c) deny + package warn + mesh ⇒ deny JSON carrying mesh exactly as today's deny-with-mesh wire (`:340-348`), package text nowhere.
- [ ] Run — FAIL. RED.
- [ ] Implement in `guard-run.ts` (behavior-preserving refactor): extract the existing `buildGuardHookOutput` body from the store lookup (current `ensureStoreReady` at `:217`) through the output returns (current `:337-361`) into an inner `firewallStage(...)` returning `FirewallStageResult` — each early `return ""` becomes `{ kind: "none" }`, the deny/warn JSON builders move into `composeGuardOutputs`, and every side-effect write stays exactly where it is. MESH CONTRACT (architect M4): mesh stays computed as today (before the firewall branch, `:222-236`, incl. the non-project path) and stays joined at the four caller sites (`:239-244` non-project, `:268-273` no-match, `:339-356` deny, `:358-361` warn) — when the composed result is non-empty the caller appends `meshAdditional` as `\n\n${meshAdditional}`; when `""`, today's mesh-only behavior is unchanged. In `buildGuardHookOutput`: compute the `packageFirewall` stage via `buildPackageFirewallText({ payload, storeRoot, now })` inside its own try/catch (failure or `""` ⇒ `{ kind: "none" }`), computed INDEPENDENTLY of the project lookup — the package firewall is store-scoped and must fire with no registered project, so the firewall stage's `project === null` short-circuit must not suppress it. Tail: `return composeGuardOutputs({ firewall, packageFirewall })`. `runGuardHookFromProcess` is untouched (it already writes any non-empty result).
- [ ] Regression: `pnpm --filter @megasaver/cli test -- test/hooks/guard-run.test.ts` — existing guard tests green UNMODIFIED (they exercise Bash payloads only, where the package stage is structurally `none` — verified against the current fixtures).
- [ ] Run the new test file — PASS; package suite green. GREEN.
- [ ] Commit: `feat(cli): compose package firewall into guard hook`

Coordination: if generated-file-fence Task 6 lands first, `composeGuardOutputs` and the extracted `firewallStage` already exist — this task then ONLY adds the `packageFirewall` input (ordered after mistake-firewall, before mesh) and extends the compose tests; do not re-extract or add a second helper.

---

### Task 9: `mega firewall status / refresh / allow`

**Files:**
- `apps/cli/src/commands/firewall.ts` → `apps/cli/src/commands/firewall/index.ts` (git mv; add explicit positional dispatch — NOT citty `subCommands`, see below)
- `apps/cli/src/commands/firewall/status.ts` (new)
- `apps/cli/src/commands/firewall/refresh.ts` (new — the ONLY module in the feature that touches `fetch`)
- `apps/cli/src/commands/firewall/allow.ts` (new)
- `apps/cli/src/main.ts` (line 14: import path → `./commands/firewall/index.js`)
- `apps/cli/test/commands/firewall.test.ts` (update import path only)
- `apps/cli/test/commands/firewall-subcommands.test.ts` (new)

**Interfaces:**

```ts
// refresh.ts
export const REFRESH_MAX_NAMES = 100;
export const REFRESH_TIMEOUT_MS = 5_000;
export function registryUrl(ref: PackageRef): string; // npm: https://registry.npmjs.org/<encoded name> · pypi: https://pypi.org/pypi/<name>/json
export type RunFirewallRefreshInput = {
  storeRoot: string; names: string[]; ecosystem: PackageEcosystem | undefined;
  fetchImpl: typeof fetch; now: () => number;
  stdout: (line: string) => void; stderr: (line: string) => void;
};
export async function runFirewallRefresh(input: RunFirewallRefreshInput): Promise<0 | 1>;
// status.ts
export type RunFirewallStatusInput = { storeRoot: string; now: () => number; stdout: (line: string) => void };
export function runFirewallStatus(input: RunFirewallStatusInput): 0;
// allow.ts
export type RunFirewallAllowInput = { storeRoot: string; name: string; ecosystem: PackageEcosystem; now: () => number; stdout: (line: string) => void; stderr: (line: string) => void };
export function runFirewallAllow(input: RunFirewallAllowInput): 0 | 1;
```

- [ ] Write failing test `apps/cli/test/commands/firewall-subcommands.test.ts` (cli-test-pattern, wiki/workflows/cli-test-pattern: inner-run functions take injected IO, no Citty env-var indirection needed):
  - `runFirewallAllow` valid name ⇒ exit 0, `firewall/allowlist.json` written, output line `allowed left-padd (npm)`; grammar-invalid name (`"not a name!"`) ⇒ exit 1, stderr explains.
  - `runFirewallStatus` on empty store ⇒ prints seed sizes, `cache: none` per ecosystem, `allowlist: 0 entries`, and the private-name notice line `note: refresh sends bare package names to public registries; allowlist private names first`; after an `appendCachedNames` + one allow ⇒ counts and `refreshedAt` shown.
  - `runFirewallRefresh` with `fetchImpl` stub: names `["left-padd", "preact"]`, stub returns `new Response(null, { status: 404 })` for `left-padd` and `new Response("{}", { status: 200 })` for `preact` ⇒ output marks `left-padd NOT FOUND — likely hallucinated`, `preact verified`, cache now contains `preact`; exit 0. Stub asserting the exact URLs from `registryUrl`. A rejecting `fetchImpl` (network down) ⇒ per-name `unverified (network error)`, exit 0. No names given and no ledger unknowns ⇒ friendly no-op line, exit 0. With ledger unknowns present (seed `events.jsonl` with two `unknown-package` events) and no args ⇒ those names are the refresh set, capped at `REFRESH_MAX_NAMES`, allowlisted names skipped.
- [ ] Run — FAIL. RED.
- [ ] `git mv apps/cli/src/commands/firewall.ts apps/cli/src/commands/firewall/index.ts`; fix its relative imports (`../store.js` → `../../store.js`, `./savings/index.js` → `../savings/index.js`). Update `main.ts:14` and the moved test's import path.
- [ ] Wire dispatch WITHOUT citty `subCommands` — VERIFIED against the vendored `citty@0.1.6` (`node_modules/citty/dist/index.mjs`, `runCommand` lines 292-317): (a) after dispatching a matched subcommand it ALSO invokes the parent `run` (the parent-run call sits outside the dispatch branch), so `mega firewall status` would run status AND then the Pro audit/upsell; (b) an unknown first positional throws `E_UNKNOWN_COMMAND` rather than falling back to the parent `run`; (c) with `subCommands` present the FIRST non-dash token is taken as the subcommand name, so `mega firewall --days 7` would throw `E_UNKNOWN_COMMAND` on `"7"` — a parent-run guard cannot intercept any of these. ARCHITECT-FOLDED (B1): the shipped parent ALREADY declares `subCommands: { airlock }` — empirically `mega firewall --days 7` throws `E_UNKNOWN_COMMAND` TODAY (the shipped defect this feature repairs). The `subCommands` block is REMOVED entirely; `airlock` folds into the same positional dispatch: the existing `defineCommand` keeps its `meta`/`args` and its `run` grows a dispatch head — `const verb = ctx.args._[0]`; if `verb` is `"status" | "refresh" | "allow" | "airlock"`, delegate via citty's exported `runCommand(<subCmd>, { rawArgs: ctx.rawArgs.slice(ctx.rawArgs.indexOf(verb) + 1) })` and return; otherwise the audit body runs byte-identical (bare `mega firewall`, `--days 7`, `--json` all unchanged). Subcommand flags (`--ecosystem`, `--store`) are parsed by each subcommand's own `defineCommand` from the sliced rawArgs — pass them AFTER the verb. Name the three new verbs in `meta.description` so `--help` surfaces them; `mega firewall airlock list|clear` keeps working through the same dispatch (the airlock `defineCommand` and its tests are unchanged).
- [ ] Citty-layer regression test (architect B1 — nothing previously exercised this layer; every firewall test calls `runFirewall` directly): extend `apps/cli/test/commands/firewall-subcommands.test.ts` with a dispatch test invoking the parent command's `run` (or `runMain`) with rawArgs — `["--days", "7"]` reaches the audit body (NOT `E_UNKNOWN_COMMAND`), `["status"]` reaches status, `["airlock", "list"]` reaches the airlock verb, `["bogus"]` errors cleanly.
- [ ] Implement the three subcommands: thin Citty handlers over the inner run functions (defaults: `fetchImpl: fetch`, `now: () => Date.now()`, store via `resolveStorePath(readStoreEnv(args.store))`). `refresh` flow: resolve name set (args → else unique `packageName`s of `unknown-package` events from the last 30 days, minus allowlisted, cap `REFRESH_MAX_NAMES`); ARCHITECT-FOLDED (M5): grammar-validate EVERY arg-provided name with `isValidPackageName` (PyPI names via `normalizePypiName` first) BEFORE any fetch or cache append — invalid ⇒ stderr + exit 1, never reaches the registry or the cache; per name `fetchImpl(registryUrl(ref), { signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) })` with per-name progress lines as they resolve (m13); 200 ⇒ collect, 404 ⇒ hallucinated report, other/throw ⇒ unverified; single `appendCachedNames` per ecosystem at the end; exit 1 only on invalid args or when the cache write reports a lock failure.
- [ ] Run the new test file + moved audit test — PASS. `pnpm --filter @megasaver/cli test` green. GREEN.
- [ ] Smoke (recorded for DoD 5): `pnpm --filter @megasaver/cli build && node apps/cli/dist/main.js firewall --help` shows the audit description naming the three verbs; `node apps/cli/dist/main.js firewall status` prints seed sizes and NOTHING from the audit/upsell path (dispatch regression); `node apps/cli/dist/main.js firewall --days 7` still runs the audit (value flags must not be eaten by dispatch).
- [ ] Commit: `feat(cli): mega firewall status/refresh/allow`

---

### Task 10: offline structural guard, changeset, wiki

**Files:**
- `apps/cli/test/hooks/package-firewall-offline.test.ts` (new)
- `.changeset/package-hallucination-firewall.md` (new)
- `wiki/entities/context-gate.md`, `wiki/entities/cli.md`, `wiki/log.md` (update)

- [ ] Write `apps/cli/test/hooks/package-firewall-offline.test.ts` — reads SOURCE files via `fileURLToPath(new URL(..., import.meta.url))`:

```ts
const HOOK_PATH_SOURCES = [
  "../../src/hooks/package-firewall-run.ts",
  "../../src/hooks/guard-run.ts",
  "../../../../packages/context-gate/src/package-refs.ts",
  "../../../../packages/context-gate/src/package-local-resolve.ts",
  "../../../../packages/context-gate/src/package-registry-cache.ts",
  "../../../../packages/context-gate/src/package-typosquat.ts",
];
const FORBIDDEN = ["fetch(", "node:http", "node:https", "undici"];
```

  Assert every hook-path source contains NONE of `FORBIDDEN`, and — non-vacuity (wiki/concepts/redos-guard-testing: assert the instrument can fire) — that `../../src/commands/firewall/refresh.ts` DOES contain `fetch(`. RED first by temporarily adding `// fetch(` to `package-refs.ts`, watch it fail, revert.
- [ ] Changeset `.changeset/package-hallucination-firewall.md`: `"@megasaver/context-gate": minor` (new public extraction/cache/typosquat surface + ledger kinds), `"@megasaver/cli": minor` (new subcommands + hook behavior). No `@megasaver/pro-analytics` entry — the package is untouched (Task 6 isolates at the CLI collectors). Body: one paragraph naming the warn-only contract and the offline hook guarantee.
- [ ] `pnpm verify` at the branch tip — lint + typecheck + full test suite green (DoD 4).
- [ ] Feature smoke evidence (DoD 5, captured terminal session): pipe the Task 7 `left-padd` payload into `node apps/cli/dist/main.js hooks guard --store <tmp>` and show the warn JSON; then `firewall allow left-padd --ecosystem npm` and show the re-run is silent; then `firewall refresh left-padd preact` against the real registries (one phantom, one real).
- [ ] Update wiki: `entities/context-gate.md` (package-firewall modules + ledger kinds), `entities/cli.md` (`mega firewall status/refresh/allow`, guard-hook composition), timestamped `wiki/log.md` entry.
- [ ] Commit: `docs(wiki): package-hallucination firewall notes` (changeset rides the Task 9/10 feature commits per repo habit; keep it in this final commit if unstaged).

---

## Self-review

- Verified against source: `appendFirewallEvent`/`firewallEventSchema`/`firewallLogPath` (`packages/context-gate/src/firewall-ledger.ts:7-33`), `buildGuardHookOutput`/`runGuardHookFromProcess` and the deny/additionalContext shapes (`apps/cli/src/hooks/guard-run.ts`), `GUARD_HOOK_MATCHER` (`hook-settings.ts:23`), `withFileLock(lockPath, {deadlineMs, staleMs}, fn): boolean` (`packages/shared/src/file-lock.ts:25`, exported via `@megasaver/shared/node`), `firewallCommand` registration (`apps/cli/src/main.ts:14,73`), the closed `FirewallEventInput` union + `events: inWindow.length` counter (`packages/pro-analytics/src/firewall-report.ts:5-14,78-80`), the unfiltered alerts firewall axis (`packages/pro-analytics/src/alerts.ts:149-154`), citty 0.1.6 `runCommand` dispatch semantics (`node_modules/citty/dist/index.mjs:292-317` — parent `run` always executes; unknown positional throws), §3c allow-list containing `@megasaver/context-gate` (`apps/cli/test/dependency-graph.test.ts:33`), flat context-gate test dir, `apps/cli/test/{hooks,commands}/` layout.
- ASSUMPTION markers: 2 — npm search-API pagination (Task 4), top-pypi-packages dataset URL (Task 4). The former citty-dispatch assumption is resolved: the vendored source settles it (Task 9 dispatches explicitly).
- Fixture sanity: `left-pad` is in the curated `NPM_TOP` so the `left-padd` typosquat fixtures in Tasks 4/7/10 resolve deterministically offline; `requests` in `PYPI_TOP` backs `reqeusts`.
- Regression gates the spec locks: the Task 8 refactor of `buildGuardHookOutput` is behavior-preserving (existing guard-run tests pass unmodified; inert output byte-identical), no hook-install entry is added (matcher already covers edit tools), and the Pro audit path stays byte-identical for every current invocation shape (bare, `--days`, `--json`).
- Cross-pair coordination (wave-2): guard-run composition adopts the ONE seam `composeGuardOutputs` shared with generated-file-fence Task 6 and session-mesh Task 9 (whichever lands first creates it — Task 8); ledger kinds are appended, never rewritten, and `unknown-package`/`typosquat-suspect` are disjoint from the fence pair's `fence-warn`/`fence-deny`; both pairs filter their own kinds at the CLI collectors so the pro-analytics surface stays closed (Task 6).
