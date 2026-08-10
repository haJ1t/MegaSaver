# Generated-File Fence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega fence init` derives a committed, reviewable `fence.yaml` from five repo signals (lockfile basenames, build-output dirs, codegen headers, `.gitattributes linguist-generated`, vendored dirs), and the fence compiles into each agent's native dialect: Claude Code gets a PreToolUse warn (default) / deny (per-entry opt-in) via the existing guard hook, flat-file agents get a FENCE sentinel block via the existing connector machinery, and generic wrappers get `mega fence check <path>` as an exit-code gate. Every warn/deny appends a value-free row to the existing firewall ledger.

**Architecture:** New leaf package `@megasaver/fence` (deps: `@megasaver/shared`, `@megasaver/policy`, `yaml`, `zod` only — no core edge, mirrors decisions/content-store-no-core-edge) owns schema, derivation, gitattributes translation, and evaluation. Consumers: the existing guard hook (`apps/cli/src/hooks/guard-run.ts` — piggyback, no new hook process, no settings.json change), new `mega fence` CLI commands, a new FENCE sentinel block in `@megasaver/connectors-shared` wired through `mega connector sync`. Ledger = `appendFirewallEvent` (`packages/context-gate/src/firewall-ledger.ts:25`) with two new kinds appended to the enum end.

**Tech Stack:** TypeScript strict ESM, Zod, vitest, citty; `compileGlob`/`PathMatcher` from `@megasaver/policy` (`packages/policy/src/secret-paths.ts:63`, `packages/policy/src/glob-matcher.ts:10` — NFA, no regex, no ReDoS); `withFileLock` from `@megasaver/shared/node` (`packages/shared/src/file-lock.ts:25`); `yaml@^2.6.1` Document API for comment-preserving edits.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-generated-file-fence-design.md` — risk HIGH (§12): worktree `feat/generated-file-fence`, no `main` edits; `code-reviewer` AND `critic` separate passes; evidence-preserving mode only.
- Escalation tripwires (spec §Risk): touching the permission wire beyond the verified deny shape, or `mega fence init` writing outside `fence.yaml` → STOP, re-spec.
- Hook side is fail-open, always exit 0: fence parse error, missing file, unreadable dir → no enforcement, primary guard output byte-identical to today. A DENY is an explicit protocol answer emitted via the VERIFIED wire (`apps/cli/src/hooks/guard-run.ts:212-219`), never a crash. NEVER emit `permissionDecision: "allow"` (guard-run.ts:221).
- `parseFenceFile` violations are LOUD in CLI paths (`init`/`status`/`check` report, exit 1) and silent-open in the hook. `mega fence status` is the diagnosis surface.
- Warn-first: `mode` defaults to `warn`; `deny` is per-entry opt-in. Every warn/deny text names the alternative and `mega fence allow <path>`.
- Glob dialect = `compileGlob` only — no second glob engine. Caps mirror `packages/policy/src/parse-project-permissions.ts:15-16`: glob ≤ 256 chars, ≤ 512 entries, ≤ 256 allow globs; brackets rejected loudly (fail-visible, never reinterpreted). No regex over untrusted input anywhere (literal header search).
- Ledger: reuse `appendFirewallEvent` — no second ledger. New kinds `"fence-warn"`, `"fence-deny"` are APPENDED to the end of the `kind` enum (AA3 enum-order contract; pinned by test). Value-free posture (F-FW-1): `detector: "fence:<class>"`, `count: 1`, `sourcePath: <relpath>`, never file content. Ledger writes best-effort (F-FW-3): a ledger failure never suppresses the warn/deny.
- Guard-run in-handler ordering is documented and fixed: **fence → firewall → mesh** (within the firewall position: mistake-firewall text before package-firewall text). **This plan OWNS the composition seam** — `composeGuardOutputs` (Task 6) is the single guard-run output builder; the package-hallucination-firewall plan (build-order 8, `docs/superpowers/plans/2026-08-06-package-hallucination-firewall.md`, Task 8) and the session-mesh plan (`docs/superpowers/plans/2026-08-06-session-mesh.md:1378`, Task 9) ADOPT this seam, they do not define competing ones. PHF lands first with a process-layer `mergeHookOutputs(guardJson, pkgText)`; Task 6 ABSORBS it (pkgText becomes a `composeGuardOutputs` input, `mergeHookOutputs` is deleted in the same commit). Each stage is computed independently; one stage's failure never suppresses another; whichever remaining feature lands last wires its text into the seam.
- Overrides audit via git: `mega fence allow` mutates the committed file; its diff is the audit trail. No ledger row for overrides.
- Re-derivation is additive-suggest: with an existing `fence.yaml`, `init` prints suggested additions only; `--write` appends and never removes, re-modes, or touches `allow`. All edits to an existing file go through the `yaml` Document API so user comments/formatting survive.
- No pnpm catalog exists: dependency versions are declared literally (`yaml@^2.6.1`, `zod@^3.24.1` — match `packages/context-gate/package.json:33-34`).
- `apps/cli` never imports `@megasaver/stats`; the fence introduces no stats coupling and no GUI surface.
- Bash-mediated writes are a NAMED GAP (non-goal): the fence covers `Edit|Write|MultiEdit|NotebookEdit` only — already inside `GUARD_HOOK_MATCHER` (`packages/connectors/claude-code/src/hook-settings.ts:23`), so no settings change.
- No timing-tight tests (CI-slowness lesson). Determinism asserted byte-for-byte, never via wall-clock.
- Output language English; Conventional Commits, subject ≤ 50 chars.

---

### Task 1: `@megasaver/fence` scaffold + `fence.yaml` schema, loader, root locator

**Files:**
- Create: `packages/fence/package.json`, `packages/fence/tsconfig.json`, `packages/fence/tsup.config.ts`, `packages/fence/vitest.config.ts`, `packages/fence/src/index.ts`, `packages/fence/src/fence-file.ts`, `packages/fence/src/error.ts`
- Test: `packages/fence/test/fence-file.test.ts`

**Interfaces:**
- Consumes: `zod@^3.24.1`, `yaml@^2.6.1` (parse only in this task), `node:fs`/`node:path` at the load boundary. Pure-parse/loader split mirrors `parseProjectPermissions` (`packages/policy/src/parse-project-permissions.ts`).
- Produces: `FENCE_CLASSES` (declaration order is the contract; append-only), `fenceClassSchema`, `fenceEntrySchema`/`FenceEntry`, `fenceFileSchema`/`FenceFile`, `FENCE_MAX_GLOB_LENGTH = 256`, `FENCE_MAX_ENTRIES = 512`, `FENCE_MAX_ALLOW_GLOBS = 256`, `FENCE_FILE_NAME = "fence.yaml"`, `parseFenceFile(raw: unknown): FenceFile`, `serializeFenceFile(file: FenceFile): string` (stable: entries sorted by `path`), `loadFenceFile(dir: string): FenceFile | null` (`null` = absent; throws `FenceError` on unreadable/invalid), `locateFenceRoot(cwd: string): string | null`, `FenceError` (`code: "schema_invalid" | "io_failed"`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/fence/test/fence-file.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FENCE_CLASSES, FenceError, fenceFileSchema, loadFenceFile,
  locateFenceRoot, parseFenceFile, serializeFenceFile,
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
    { path: "pnpm-lock.yaml", class: "lockfile", reason: "derived: lockfile basename" },
    { path: "dist/**", class: "build-output", reason: "derived: build-output dir on disk", mode: "deny" },
  ],
};

describe("fence schema", () => {
  it("pins the class enum declaration order (append-only contract)", () => {
    expect(FENCE_CLASSES).toEqual([
      "lockfile", "build-output", "codegen-header", "linguist-generated", "vendored",
    ]);
  });
  it("accepts a valid file and rejects unknown keys (.strict())", () => {
    expect(parseFenceFile(VALID).entries).toHaveLength(2);
    expect(() => parseFenceFile({ ...VALID, extra: 1 })).toThrow(FenceError);
    expect(() =>
      parseFenceFile({ ...VALID, entries: [{ ...VALID.entries[0], why: "x" }] }),
    ).toThrow(FenceError);
  });
  it("rejects bracket globs, over-long globs, and over-cap entry counts loudly", () => {
    expect(() =>
      parseFenceFile({ version: 1, entries: [{ path: "[sS]ecrets/**", class: "vendored", reason: "r" }] }),
    ).toThrow(FenceError);
    expect(() =>
      parseFenceFile({ version: 1, entries: [{ path: "a".repeat(257), class: "vendored", reason: "r" }] }),
    ).toThrow(FenceError);
    const entries = Array.from({ length: 513 }, (_, i) => ({
      path: `gen/${i}.ts`, class: "codegen-header", reason: "r",
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/fence test`
Expected: FAIL — package does not exist / cannot resolve `../src/fence-file.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/fence/package.json` (mirrors the leaf-package pattern of `packages/content-store/package.json`; `tsup`/`typescript`/`vitest` are root devDependencies — do not redeclare):

```json
{
  "name": "@megasaver/fence",
  "version": "0.1.0",
  "license": "MIT",
  "private": true,
  "description": "Generated-file fence: derive, evaluate, and compile fence.yaml.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@megasaver/policy": "workspace:*",
    "@megasaver/shared": "workspace:*",
    "yaml": "^2.6.1",
    "zod": "^3.24.1"
  },
  "devDependencies": { "@types/node": "^22.19.17" }
}
```

`tsconfig.json` copies `packages/context-gate/tsconfig.json` (extends `../../tsconfig.base.json`, `rootDir: src`, `outDir: dist`). `tsup.config.ts` and `vitest.config.ts` copy the content-store versions (esm, dts, `include: ["test/**/*.test.ts"]`).

`src/fence-file.ts` core:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { FenceError } from "./error.js";

export const FENCE_FILE_NAME = "fence.yaml";
export const FENCE_CLASSES = [
  "lockfile", "build-output", "codegen-header", "linguist-generated", "vendored",
] as const;
export const fenceClassSchema = z.enum(FENCE_CLASSES);
export type FenceClass = (typeof FENCE_CLASSES)[number];

// Caps mirror parse-project-permissions.ts:15-16 — linear matching is not
// bounded matching; exceeding a cap is a loud FenceError, never a silent trim.
export const FENCE_MAX_GLOB_LENGTH = 256;
export const FENCE_MAX_ENTRIES = 512;
export const FENCE_MAX_ALLOW_GLOBS = 256;

const fenceGlob = z
  .string().min(1).max(FENCE_MAX_GLOB_LENGTH)
  .refine((v) => !v.includes("[") && !v.includes("]"), {
    message: "bracket expressions are not supported in fence globs",
  });

export const fenceEntrySchema = z.object({
  path: fenceGlob,
  class: fenceClassSchema,
  reason: z.string().min(1),
  mode: z.enum(["warn", "deny"]).optional(),
  alternative: z.string().min(1).optional(),
}).strict();
export type FenceEntry = z.infer<typeof fenceEntrySchema>;

export const fenceFileSchema = z.object({
  version: z.literal(1),
  allow: z.array(fenceGlob).max(FENCE_MAX_ALLOW_GLOBS).default([]),
  entries: z.array(fenceEntrySchema).max(FENCE_MAX_ENTRIES).default([]),
}).strict();
export type FenceFile = z.infer<typeof fenceFileSchema>;
```

`parseFenceFile` wraps `fenceFileSchema.safeParse` and throws `FenceError("schema_invalid", <zod message>)` on failure. `serializeFenceFile` sorts `entries` by `path` (`localeCompare` is locale-dependent — use plain `<`/`>` codepoint compare for byte-stable output) then `stringifyYaml`. `loadFenceFile(dir)` reads `join(dir, FENCE_FILE_NAME)`: `ENOENT` → `null`; other fs errors → `FenceError("io_failed")`; yaml/zod failure → `FenceError("schema_invalid")`. `locateFenceRoot(cwd)`: upward walk (`dirname` until fixed point); at each dir, if `fence.yaml` exists return the dir; if `.git` exists (dir or file — worktrees use a `.git` file) stop AFTER checking that dir; return `null` otherwise.

`src/error.ts` follows the `ConnectorError`/`ContentStoreError` house shape (typed `code`, `cause` pass-through — `packages/content-store/src/errors.ts:12`, `packages/connectors/shared/src/errors.ts:18`). `src/index.ts` re-exports the public surface only.

Run `pnpm install` once to link the new workspace package.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/fence test && pnpm --filter @megasaver/fence typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fence pnpm-lock.yaml
git commit -m "feat(fence): fence.yaml schema, loader, locator"
```

---

### Task 2: gitattributes translation

**Files:**
- Create: `packages/fence/src/gitattributes.ts`
- Modify: `packages/fence/src/index.ts`
- Test: `packages/fence/test/gitattributes.test.ts`

**Interfaces:**
- Produces: `translateGitattributes(raw: string): { globs: readonly string[]; skipped: readonly { pattern: string; reason: string }[] }` — output globs are in the `compileGlob` dialect, repo-root-relative.
- Rules (spec §Components 3): keep `linguist-generated` and `linguist-generated=true`; drop `-linguist-generated`; leading `/` stripped → anchored; bare dir pattern (trailing `/`) → `<p>/**`; patterns containing `[`/`]` or with leading `!` → `skipped[]` with a reason, NEVER silently (mis)fenced.
- ASSUMPTION: a pattern containing no `/` (e.g. `*.pb.go`) matches at any depth per gitattributes/gitignore semantics and is translated to `**/<p>`; the spec pins only the three explicit rules above, so this fourth rule is marked here and must be covered by a test either way.

- [ ] **Step 1: Write the failing test**

```ts
// packages/fence/test/gitattributes.test.ts
import { describe, expect, it } from "vitest";
import { translateGitattributes } from "../src/gitattributes.js";

const RAW = [
  "# generated artifacts",
  "/src/gen/api.ts linguist-generated=true",
  "docs/generated/ linguist-generated",
  "*.pb.go linguist-generated",
  "legacy/[ab].ts linguist-generated",
  "!never.ts linguist-generated",
  "src/handwritten.ts -linguist-generated",
  "*.lock merge=binary",
  "",
].join("\n");

describe("translateGitattributes", () => {
  it("keeps linguist-generated (bare and =true), drops negated and unrelated attrs", () => {
    const out = translateGitattributes(RAW);
    expect(out.globs).toContain("src/gen/api.ts");     // leading / stripped → anchored
    expect(out.globs).toContain("docs/generated/**");  // bare dir → <p>/**
    expect(out.globs).toContain("**/*.pb.go");         // no slash → any depth (ASSUMPTION)
    expect(out.globs).not.toContain("src/handwritten.ts");
    expect(out.globs.some((g) => g.includes("merge"))).toBe(false);
  });
  it("reports bracket and negation patterns as skipped, never mis-fenced", () => {
    const out = translateGitattributes(RAW);
    expect(out.skipped).toEqual([
      { pattern: "legacy/[ab].ts", reason: "bracket expressions unsupported" },
      { pattern: "!never.ts", reason: "negation patterns unsupported" },
    ]);
    expect(out.globs.some((g) => g.includes("["))).toBe(false);
  });
  it("is total on junk input: comments, blank lines, lone words", () => {
    expect(translateGitattributes("# x\n\nword\n")).toEqual({ globs: [], skipped: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/fence test gitattributes`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation** — line-by-line split on whitespace: first token pattern, rest attrs. Keep line iff attrs include `linguist-generated` or `linguist-generated=true` and NOT `-linguist-generated`. Then apply the four rules in order: leading `!` → skipped; contains `[` or `]` → skipped; leading `/` → strip; trailing `/` → append `**`; else if no `/` → prefix `**/`. Comments (`#`) and blank lines ignored. Pure string work, no regex over the pattern text beyond `String.prototype` methods.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/fence test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fence
git commit -m "feat(fence): gitattributes translation"
```

---

### Task 3: Deterministic derivation (`deriveFence` + default seams)

**Files:**
- Create: `packages/fence/src/derive.ts`, `packages/fence/src/derive-seams.ts`
- Modify: `packages/fence/src/index.ts`
- Test: `packages/fence/test/derive.test.ts`

**Interfaces:**
- Produces (in `derive.ts`, pure — unit tests need no git):

```ts
export const LOCKFILE_BASENAMES = [
  "pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
  "bun.lock", "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock",
  "Gemfile.lock", "composer.lock", "go.sum", "gradle.lockfile", "flake.lock",
] as const;
export const BUILD_OUTPUT_DIRS = ["dist", "build", "out", ".next", ".nuxt", "coverage", "dist-bundle"] as const;
export const VENDORED_DIRS = ["vendor", "third_party"] as const;
export const CODEGEN_HEADER_LITERALS = ["@generated", "DO NOT EDIT", "AUTO-GENERATED FILE"] as const;

export type DeriveSeams = {
  listTrackedFiles: () => readonly string[] | null; // null = no git
  readFileHead: (relPath: string) => string | null; // first 2 KiB; null = unreadable or file > 1 MiB
  dirExists: (relPath: string) => boolean;
  readGitattributes: () => string | null;
};
export type DeriveResult = {
  file: FenceFile; // version 1, allow: [], entries sorted by path
  skipped: readonly { pattern: string; reason: string }[];
  degradedSignals: readonly string[]; // ["codegen-header", "linguist-generated"] when no git
};
export function deriveFence(seams: DeriveSeams): DeriveResult;
```

- `derive-seams.ts`: `createDefaultDeriveSeams(root: string): DeriveSeams` — `listTrackedFiles` runs `git ls-files -z` via `node:child_process` `execFileSync` with `cwd: root` (NUL-split; sorted output ⇒ deterministic; any throw → `null`); `readFileHead` stats first (size > 1 MiB → `null`) then reads first 2048 bytes; `dirExists`/`readGitattributes` plain fs. Kept in its own module so `derive.ts` stays pure.
- Signal order and dedupe: (a) lockfiles → (b) build-output dirs (`<dir>/**`) → (c) codegen headers (literal substring search over `readFileHead`, no regex) → (d) gitattributes via `translateGitattributes` (class `linguist-generated`) → (e) vendored dirs (`<dir>/**`). First signal wins per identical `path`. Reasons carry the derivation: `"derived: lockfile basename"`, `"derived: build-output dir on disk"`, `"derived: codegen header \"@generated\""`, `"derived: .gitattributes linguist-generated"`, `"derived: vendored dir"`.
- No git (`listTrackedFiles` → `null`): signals (a), (b), (e) run from fs seams only — (a) checks each `LOCKFILE_BASENAMES` at root via the tracked list when present, else via `readFileHead(base) !== null`; (c), (d) are skipped and reported in `degradedSignals`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/fence/test/derive.test.ts
import { describe, expect, it } from "vitest";
import { serializeFenceFile } from "../src/fence-file.js";
import { type DeriveSeams, deriveFence } from "../src/derive.js";

const HEAD_BY_PATH: Record<string, string> = {
  "pnpm-lock.yaml": "lockfileVersion: '9.0'",
  "src/gen/api.ts": "// @generated by protoc-gen-ts — DO NOT EDIT\nexport const x = 1;",
  "src/app.ts": "export const app = 1;",
  "big.min.js": "", // stands in for the >1 MiB skip below via readFileHead → null
};

function seams(over: Partial<DeriveSeams> = {}): DeriveSeams {
  return {
    listTrackedFiles: () => Object.keys(HEAD_BY_PATH).sort(),
    readFileHead: (p) => (p === "big.min.js" ? null : (HEAD_BY_PATH[p] ?? null)),
    dirExists: (p) => ["dist", "vendor"].includes(p),
    readGitattributes: () => "/src/gen/api.ts linguist-generated\nlegacy/[ab].ts linguist-generated\n",
    ...over,
  };
}

describe("deriveFence", () => {
  it("derives all five signal classes with reasons, sorted by path", () => {
    const out = deriveFence(seams());
    expect(out.file.entries).toEqual([
      { path: "dist/**", class: "build-output", reason: "derived: build-output dir on disk" },
      { path: "pnpm-lock.yaml", class: "lockfile", reason: "derived: lockfile basename" },
      { path: "src/gen/api.ts", class: "codegen-header", reason: 'derived: codegen header "@generated"' },
      { path: "vendor/**", class: "vendored", reason: "derived: vendored dir" },
    ]);
    expect(out.skipped).toEqual([{ pattern: "legacy/[ab].ts", reason: "bracket expressions unsupported" }]);
    expect(out.degradedSignals).toEqual([]);
  });
  it("first signal wins on a path double-hit (codegen beats gitattributes here)", () => {
    const out = deriveFence(seams());
    const gen = out.file.entries.filter((e) => e.path === "src/gen/api.ts");
    expect(gen).toHaveLength(1);
    expect(gen[0]?.class).toBe("codegen-header");
  });
  it("files over the size cap are skipped by the head seam, not scanned", () => {
    const out = deriveFence(seams());
    expect(out.file.entries.some((e) => e.path === "big.min.js")).toBe(false);
  });
  it("no git → fs-only signals, (c) and (d) reported degraded", () => {
    const out = deriveFence(seams({ listTrackedFiles: () => null }));
    expect(out.degradedSignals).toEqual(["codegen-header", "linguist-generated"]);
    expect(out.file.entries.some((e) => e.class === "codegen-header")).toBe(false);
    expect(out.file.entries.some((e) => e.path === "dist/**")).toBe(true);
  });
  it("derivation is deterministic: derive twice → byte-identical serialization", () => {
    const a = serializeFenceFile(deriveFence(seams()).file);
    const b = serializeFenceFile(deriveFence(seams()).file);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/fence test derive`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation** — as specified in Interfaces. Collect into a `Map<path, FenceEntry>` guarded by `if (!map.has(path))` for the first-wins rule; final `file` built via `fenceFileSchema.parse({ version: 1, allow: [], entries: sorted })` so caps apply at the same boundary as user files (a >512-entry derivation THROWS `FenceError` here — the CLI surfaces it in Task 7).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/fence test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fence
git commit -m "feat(fence): deterministic fence derivation"
```

---

### Task 4: Evaluation (`compileFence` / `evaluateFenceWrite`) + warn/deny texts + hook composition helper

**Files:**
- Create: `packages/fence/src/evaluate.ts`, `packages/fence/src/texts.ts`, `packages/fence/src/hook.ts`
- Modify: `packages/fence/src/index.ts`
- Test: `packages/fence/test/evaluate.test.ts`, `packages/fence/test/hook.test.ts`

**Interfaces:**
- Consumes: `compileGlob` (`packages/policy/src/secret-paths.ts:63`), `PathMatcher` (`packages/policy/src/glob-matcher.ts:10`).
- Produces (`evaluate.ts`):

```ts
export type CompiledFence = {
  allow: readonly PathMatcher[];
  entries: ReadonlyArray<{ entry: FenceEntry; matcher: PathMatcher }>;
};
export function compileFence(file: FenceFile): CompiledFence;
export type FenceVerdict =
  | { verdict: "allowed" }
  | { verdict: "warn" | "deny"; entry: FenceEntry };
export function evaluateFenceWrite(input: { compiled: CompiledFence; relPath: string }): FenceVerdict;
export function normalizeFencePath(p: string): string; // fold "\" → "/", lower-case
```

  Path/glob case semantics mirror `normalizePath` in `packages/policy/src/secret-paths.ts` exactly (lower-case + separator fold, applied to BOTH glob at compile and path at evaluate) so a Windows-style path cannot bypass an entry — same rationale as the secret-path matcher. Precedence: allow globs first (allowed, silent); then entries in file order, first match returns `{ verdict: entry.mode ?? "warn", entry }`.
- Produces (`texts.ts`): `fenceAlternative(entry): string` — `entry.alternative` override, else per-class defaults: lockfile → `edit the manifest and run the package manager (e.g. \`pnpm install\`) instead`; build-output → `edit the source and rebuild instead`; codegen-header → `edit the generator or template, then re-run codegen`; linguist-generated → `regenerate via the producing tool`; vendored → `patch upstream or re-vendor instead`. `formatFenceWarn(entry, relPath)` / `formatFenceDenyReason(entry, relPath)` — both name the class, the reason, the alternative, and the override one-liner `mega fence allow <relPath>`.
- Produces (`hook.ts` — the silent-open composition the guard hook consumes):

```ts
export type FenceHookVerdict =
  | { kind: "none" }
  | { kind: "warn" | "deny"; entry: FenceEntry; relPath: string; text: string };
// NEVER throws: locate → load → compile → evaluate; any failure (parse error,
// unreadable dir, path outside fence root) → { kind: "none" } (fail-open).
export function evaluateFenceForWrite(input: { cwd: string; filePath: string }): FenceHookVerdict;
```

  `filePath` may be absolute or relative (resolved against `cwd`); relPath computed via `node:path` `relative(fenceRoot, abs)` then `normalizeFencePath`; a path escaping the fence root (`../` prefix after relative) → `{ kind: "none" }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/fence/test/evaluate.test.ts
import { describe, expect, it } from "vitest";
import { parseFenceFile } from "../src/fence-file.js";
import { compileFence, evaluateFenceWrite, normalizeFencePath } from "../src/evaluate.js";
import { formatFenceDenyReason, formatFenceWarn } from "../src/texts.js";

const FILE = parseFenceFile({
  version: 1,
  allow: ["dist/keep.txt"],
  entries: [
    { path: "dist/**", class: "build-output", reason: "derived: build-output dir on disk", mode: "deny" },
    { path: "pnpm-lock.yaml", class: "lockfile", reason: "derived: lockfile basename" },
  ],
});
const compiled = compileFence(FILE);
const verdictOf = (relPath: string) => evaluateFenceWrite({ compiled, relPath });

describe("evaluateFenceWrite", () => {
  it("allow globs win over entries (allowed, silent)", () => {
    expect(verdictOf("dist/keep.txt")).toEqual({ verdict: "allowed" });
  });
  it("first matching entry decides; mode defaults to warn", () => {
    const deny = verdictOf("dist/bundle.js");
    expect(deny.verdict).toBe("deny");
    const warn = verdictOf("pnpm-lock.yaml");
    expect(warn.verdict).toBe("warn");
    expect(verdictOf("src/app.ts")).toEqual({ verdict: "allowed" });
  });
  it("win32 separators and case cannot bypass an entry (structural, no node:path)", () => {
    expect(normalizeFencePath("DIST\\Bundle.JS")).toBe("dist/bundle.js");
    expect(evaluateFenceWrite({ compiled, relPath: normalizeFencePath("DIST\\Bundle.JS") }).verdict).toBe("deny");
  });
});

describe("texts", () => {
  it("warn names class, alternative, and the override one-liner", () => {
    const v = verdictOf("pnpm-lock.yaml");
    if (v.verdict === "allowed") throw new Error("expected warn");
    const text = formatFenceWarn(v.entry, "pnpm-lock.yaml");
    expect(text).toContain("Generated-File Fence");
    expect(text).toContain("lockfile");
    expect(text).toContain("pnpm install");
    expect(text).toContain("mega fence allow pnpm-lock.yaml");
  });
  it("deny reason carries the same guidance", () => {
    const v = verdictOf("dist/bundle.js");
    if (v.verdict === "allowed") throw new Error("expected deny");
    expect(formatFenceDenyReason(v.entry, "dist/bundle.js")).toContain("mega fence allow dist/bundle.js");
  });
});
```

```ts
// packages/fence/test/hook.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateFenceForWrite } from "../src/hook.js";

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "megasaver-fencehookpkg-"));
  mkdirSync(join(repo, ".git"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const YAML = [
  "version: 1",
  "entries:",
  "  - path: pnpm-lock.yaml",
  "    class: lockfile",
  '    reason: "derived: lockfile basename"',
  "",
].join("\n");

describe("evaluateFenceForWrite", () => {
  it("no fence.yaml → none; fenced path → warn with text; absolute and relative agree", () => {
    expect(evaluateFenceForWrite({ cwd: repo, filePath: "pnpm-lock.yaml" })).toEqual({ kind: "none" });
    writeFileSync(join(repo, "fence.yaml"), YAML);
    const abs = evaluateFenceForWrite({ cwd: repo, filePath: join(repo, "pnpm-lock.yaml") });
    const rel = evaluateFenceForWrite({ cwd: repo, filePath: "pnpm-lock.yaml" });
    expect(abs.kind).toBe("warn");
    expect(rel).toEqual(abs);
    if (abs.kind !== "warn") throw new Error("unreachable");
    expect(abs.relPath).toBe("pnpm-lock.yaml");
    expect(abs.text).toContain("mega fence allow pnpm-lock.yaml");
  });
  it("fail-open: unparsable fence.yaml → none; path outside fence root → none", () => {
    writeFileSync(join(repo, "fence.yaml"), "{{{{");
    expect(evaluateFenceForWrite({ cwd: repo, filePath: "pnpm-lock.yaml" })).toEqual({ kind: "none" });
    writeFileSync(join(repo, "fence.yaml"), YAML);
    expect(evaluateFenceForWrite({ cwd: repo, filePath: join(tmpdir(), "elsewhere.txt") })).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/fence test evaluate hook`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation** — as specified in Interfaces. `compileFence` compiles allow + entry globs once through `compileGlob` on the NORMALIZED glob text. `evaluateFenceForWrite` composes `locateFenceRoot` → `loadFenceFile` → `compileFence` → `evaluateFenceWrite` inside one try/catch returning `{ kind: "none" }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/fence test && pnpm --filter @megasaver/fence typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fence
git commit -m "feat(fence): write evaluation and fence texts"
```

---

### Task 5: Firewall ledger kinds `fence-warn` / `fence-deny` + reader isolation

**Files:**
- Modify: `packages/context-gate/src/firewall-ledger.ts` (extend `kind` enum, export `FENCE_FIREWALL_KINDS`), `packages/context-gate/src/index.ts`, `apps/cli/src/commands/firewall.ts`, `apps/cli/src/commands/alerts.ts`
- Test: extend `packages/context-gate/test/firewall-ledger.test.ts`, `apps/cli/test/commands/firewall.test.ts`, `apps/cli/test/commands/alerts.test.ts`

**Interfaces:**
- `firewallEventSchema.kind` (`packages/context-gate/src/firewall-ledger.ts:10`) gains `"fence-warn"`, `"fence-deny"` APPENDED after whatever kinds exist at land time (AA3 append-only contract — never a full-enum rewrite). At spec time the base is `["blocked-read", "redacted", "observed"]`; package-hallucination-firewall (build-order 8, lands BEFORE this pair at 18) will already have appended `"unknown-package"`, `"typosquat-suspect"` (its plan Task 6, line 525) — this task appends the two fence kinds after those and must not drop or reorder them.
- New export: `export const FENCE_FIREWALL_KINDS = ["fence-warn", "fence-deny"] as const;` re-exported from `packages/context-gate/src/index.ts` beside the ledger exports (index.ts:149-157).
- Load-bearing consequence (verified): `diagnoseFirewall` takes `FirewallEventInput` with a CLOSED kind union (`packages/pro-analytics/src/firewall-report.ts:7`), and `detectAlerts` sums EVERY event into the firewall spike axis with no kind filter (`packages/pro-analytics/src/alerts.ts:149-154`). After the enum extension the widened `FirewallEvent` no longer assigns to `FirewallEventInput`, so BOTH CLI read sites (`apps/cli/src/commands/firewall.ts:78`, `apps/cli/src/commands/alerts.ts:81` — the `safeParse` collectors) MUST filter fence kinds before handing events to pro-analytics — mirroring how PHF filters its package kinds from the same collectors (cross-pair contract: each feature filters its own kinds off the detectAlerts spike axis). This keeps the firewall report totals and the alerts "firewall" spike axis meaning exactly what they meant pre-fence (spec Locked Decision 7: "the alerts firewall spike axis must not silently change meaning — checked in tests"). pro-analytics gains NO fence kinds: PHF's Task 6 will already have widened the local `FirewallEvent.kind` union in `firewall-report.ts` for its package kinds, but the fence adds nothing there — the union stays closed to `fence-warn`/`fence-deny`, which is the compile tripwire (no new dep edges).

- [ ] **Step 1: Write the failing tests**

Extend `packages/context-gate/test/firewall-ledger.test.ts` (harness already there — `mkdtempSync` root, `AT` constant):

```ts
  it("pins fence kinds appended at the enum end (AA3 tripwire, append-relative)", () => {
    const options = firewallEventSchema.shape.kind.options;
    // Append-relative on purpose: PHF (build-order 8) appends its own kinds
    // first; never assert full-array equality against a moving enum.
    expect(options.slice(0, 3)).toEqual(["blocked-read", "redacted", "observed"]);
    expect(options.slice(-2)).toEqual(["fence-warn", "fence-deny"]);
    expect(FENCE_FIREWALL_KINDS).toEqual(["fence-warn", "fence-deny"]);
  });

  it("accepts value-free fence rows", () => {
    appendFirewallEvent(root, {
      at: AT, kind: "fence-warn", detector: "fence:lockfile", count: 1,
      sourcePath: "pnpm-lock.yaml",
    });
    const line = readFileSync(firewallLogPath(root), "utf8").trim();
    expect(firewallEventSchema.safeParse(JSON.parse(line)).success).toBe(true);
  });
```

Extend `apps/cli/test/commands/firewall.test.ts` and `apps/cli/test/commands/alerts.test.ts` (reuse each suite's existing input builders): write a ledger containing N legacy rows plus fence rows dated today, run the command twice — once with the fence rows present, once without — and assert the emitted report/alert output is IDENTICAL (fence rows do not change `events` totals, `redactedByDetector`, or trip the `firewall` axis). Real fence row fixture:

```ts
{ at: NOW, kind: "fence-warn", detector: "fence:lockfile", count: 1, sourcePath: "pnpm-lock.yaml" }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/context-gate test firewall-ledger`
Expected: FAIL — enum options mismatch, `FENCE_FIREWALL_KINDS` unresolved.
Run: `pnpm --filter @megasaver/cli typecheck`
Expected: after the enum lands, FAIL at the two pro-analytics call sites until the filters are added — this compile error is the designed tripwire; do not "fix" it by widening pro-analytics with fence kinds (PHF's earlier package-kind widen of `firewall-report.ts` stays as it landed).

- [ ] **Step 3: Write minimal implementation** — enum extension + constant in `firewall-ledger.ts`; in both CLI collectors, after `result.success`, skip rows whose kind is in `FENCE_FIREWALL_KINDS` before pushing into the array handed to pro-analytics (one `if` per site; 3 similar lines beat an abstraction).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/context-gate test && pnpm --filter @megasaver/cli test firewall alerts && pnpm typecheck`
Expected: PASS, including all pre-existing ledger/report tests.

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate apps/cli
git commit -m "feat(context-gate): fence kinds in fw ledger"
```

---

### Task 6: Guard-run piggyback (Claude Code dialect)

**Files:**
- Modify: `apps/cli/src/hooks/guard-run.ts`, `apps/cli/package.json` (add `"@megasaver/fence": "workspace:*"` to devDependencies — the CLI ships as a self-contained bundle; workspace deps are build-time inputs, per the comment in `apps/cli/test/dependency-graph.test.ts`), `apps/cli/test/dependency-graph.test.ts` (extend `ALLOWED_MEGA_DEPENDENCIES` with `"@megasaver/fence"`; acyclic — fence depends only on policy/shared/yaml/zod, never on the CLI)
- Test: `apps/cli/test/hooks/fence-guard.test.ts`

**Interfaces:**
- Consumes: `buildGuardHookOutput` (`apps/cli/src/hooks/guard-run.ts:100`), `GUARDED_EDIT_TOOLS` (guard-run.ts:25), the `file_path`/`notebook_path` extraction (guard-run.ts:118), the verified deny wire (guard-run.ts:212-219), the never-`"allow"` rule (guard-run.ts:221); `evaluateFenceForWrite` from `@megasaver/fence` (lazy `await import` per decisions/lazy-load-heavy-deps); `appendFirewallEvent` from `@megasaver/context-gate` (already a dependency — guard-run.ts:3).
- Produces: new exported pure helper in guard-run.ts:

```ts
export type FirewallStageResult =
  | { kind: "none" }
  | { kind: "warn"; text: string }
  | { kind: "deny"; reason: string };
export function composeGuardOutputs(input: {
  fence: { kind: "none" } | { kind: "warn"; text: string };
  firewall: FirewallStageResult;
  packageFirewallText?: string; // PHF's pkgText ("" or absent = silent) — see absorption note
}): string; // "" | additionalContext JSON | deny JSON — the ONLY output builder
```

- Seam ownership (cross-pair contract): `composeGuardOutputs` is OWNED by this plan; package-hallucination-firewall and session-mesh adopt it. PHF (build-order 8) lands BEFORE this pair (18) with a process-layer `mergeHookOutputs(guardJson, pkgText)` in `guard-run.ts` that leaves `buildGuardHookOutput` untouched (its plan Task 8, lines 602-649). This task ABSORBS that merge: `buildPackageFirewallText`'s result feeds `composeGuardOutputs` as `packageFirewallText`, `mergeHookOutputs` is DELETED in the same commit, and its compose tests are re-pointed at `composeGuardOutputs` (preserving their assertions: package text joins after the firewall warn text; a deny still suppresses all warn texts). After this task, "the ONLY output builder" is true again.

- Refactor shape (behavior-preserving for the firewall): extract the existing body from the store lookup (guard-run.ts:125) through the output returns (guard-run.ts:212-224) into an inner `firewallStage(...)` that returns `FirewallStageResult` instead of JSON strings (every current early `return ""` becomes `{ kind: "none" }`; side-effect writes stay exactly where they are). The tail of `buildGuardHookOutput` becomes `return composeGuardOutputs({ fence, firewall })`. All pre-existing guard-run tests must pass unchanged — that is the regression gate for the refactor.
- Fence stage runs AFTER `call` is built (guard-run.ts:110-123) and BEFORE the store/project lookup — it is repo-scoped and must fire with no registered project. Bash calls skip the fence entirely (named gap).
- Ordering contract (documented in a code comment at the compose site): **fence → firewall → mesh**, with mistake-firewall text before package-firewall text inside the firewall position. Rules: fence `deny` short-circuits with the verified wire + a `fence-deny` ledger row before the firewall stage runs; firewall strict `deny` wins unchanged and the fence warn is DROPPED for that call (the write is blocked anyway); warn texts concatenate in order — fence text, `\n`, mistake-firewall text, then package-firewall text — into one `additionalContext`. When session-mesh Task 9 lands, its text joins as the final input of `composeGuardOutputs` — the helper is the seam, and this plan owns it.
- Ledger rows (best-effort, value-free): `appendFirewallEvent(input.storeRoot, { at: new Date(input.now()).toISOString(), kind: "fence-warn" | "fence-deny", detector: "fence:<entry.class>", count: 1, sourcePath: <relPath>, sessionId })` — no projectId (none may exist), never content.

- [ ] **Step 1: Write the failing test** — harness copied from `apps/cli/test/hooks/guard-run.test.ts:55` (payload-object injection via a `call(payload)` wrapper around `buildGuardHookOutput({ payload, storeRoot, now })`; no stdin piping):

```ts
// apps/cli/test/hooks/fence-guard.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firewallLogPath } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGuardHookOutput, composeGuardOutputs } from "../../src/hooks/guard-run.js";

const NOW = "2026-08-06T12:00:00.000Z";
let root: string; // store root
let repo: string; // fenced repo (has .git so locateFenceRoot stops here)
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-fenceguard-"));
  repo = mkdtempSync(join(tmpdir(), "megasaver-fencerepo-"));
  mkdirSync(join(repo, ".git"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const FENCE_YAML = [
  "version: 1",
  "allow:",
  "  - docs/generated/README.md",
  "entries:",
  "  - path: pnpm-lock.yaml",
  "    class: lockfile",
  '    reason: "derived: lockfile basename"',
  "  - path: dist/**",
  "    class: build-output",
  '    reason: "derived: build-output dir on disk"',
  "    mode: deny",
  "",
].join("\n");

function editPayload(filePath: string) {
  return {
    session_id: "s1", cwd: repo, tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "a", new_string: "b" },
  };
}
function call(payload: unknown) {
  return buildGuardHookOutput({ payload, storeRoot: root, now: () => Date.parse(NOW) });
}
function ledgerRows(): unknown[] {
  try {
    return readFileSync(firewallLogPath(root), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe("guard-run fence stage", () => {
  it("no fence.yaml → output byte-identical to today (inert)", async () => {
    expect(await call(editPayload(join(repo, "src/app.ts")))).toBe("");
  });

  it("warns on a fenced lockfile with no registered project (repo-scoped)", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const out = JSON.parse(await call(editPayload(join(repo, "pnpm-lock.yaml"))));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Generated-File Fence");
    expect(ctx).toContain("pnpm install");
    expect(ctx).toContain("mega fence allow pnpm-lock.yaml");
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  it("denies a deny-mode entry with the verified wire, exact shape", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    const out = JSON.parse(await call(editPayload(join(repo, "dist/bundle.js"))));
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("mega fence allow dist/bundle.js");
    expect(out.hookSpecificOutput.additionalContext).toBeUndefined();
  });

  it("appends value-free ledger rows for warn and deny", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    await call(editPayload(join(repo, "pnpm-lock.yaml")));
    await call(editPayload(join(repo, "dist/bundle.js")));
    const rows = ledgerRows();
    expect(rows).toMatchObject([
      { kind: "fence-warn", detector: "fence:lockfile", count: 1, sourcePath: "pnpm-lock.yaml", sessionId: "s1" },
      { kind: "fence-deny", detector: "fence:build-output", count: 1, sourcePath: "dist/bundle.js", sessionId: "s1" },
    ]);
    for (const row of rows) expect(JSON.stringify(row)).not.toContain("old_string");
  });

  it("allow glob silences the fence; Bash stays out of scope; corrupt fence is inert", async () => {
    writeFileSync(join(repo, "fence.yaml"), FENCE_YAML);
    expect(await call(editPayload(join(repo, "docs/generated/README.md")))).toBe("");
    expect(
      await call({ session_id: "s1", cwd: repo, tool_name: "Bash", tool_input: { command: "echo x > pnpm-lock.yaml" } }),
    ).toBe("");
    writeFileSync(join(repo, "fence.yaml"), "{{{{");
    expect(await call(editPayload(join(repo, "pnpm-lock.yaml")))).toBe("");
  });

  it("imports @megasaver/fence lazily — no top-level import (hot-path guard)", () => {
    const src = readFileSync(new URL("../../src/hooks/guard-run.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^import[^\n]*"@megasaver\/fence"/m);
    expect(src).toContain('await import("@megasaver/fence")');
  });
});

describe("composeGuardOutputs (documented order: fence → firewall → mesh)", () => {
  it("both warn → fence text first, one additionalContext", () => {
    const out = JSON.parse(composeGuardOutputs({
      fence: { kind: "warn", text: "FENCE" },
      firewall: { kind: "warn", text: "FIREWALL" },
    }));
    expect(out.hookSpecificOutput.additionalContext).toBe("FENCE\nFIREWALL");
  });
  it("package-firewall text joins after the mistake-firewall text (absorbed mergeHookOutputs)", () => {
    const out = JSON.parse(composeGuardOutputs({
      fence: { kind: "warn", text: "FENCE" },
      firewall: { kind: "warn", text: "FIREWALL" },
      packageFirewallText: "PKG",
    }));
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(ctx.startsWith("FENCE\nFIREWALL")).toBe(true);
    expect(ctx.endsWith("PKG")).toBe(true);
  });
  it("firewall strict deny wins unchanged; fence warn dropped (write blocked anyway)", () => {
    const out = JSON.parse(composeGuardOutputs({
      fence: { kind: "warn", text: "FENCE" },
      firewall: { kind: "deny", reason: "R" },
    }));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe("R");
    expect(JSON.stringify(out)).not.toContain("FENCE");
  });
  it("none + none → empty string (no injection)", () => {
    expect(composeGuardOutputs({ fence: { kind: "none" }, firewall: { kind: "none" } })).toBe("");
  });
});
```

  NOTE: the merge-order test intentionally targets the extracted pure helper rather than seeding a live T2 edit-tool firewall match (BM25 seeding is brittle); the live warn/deny paths above plus the pre-existing guard-run suite cover the wiring ends.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test fence-guard`
Expected: FAIL — `composeGuardOutputs` unresolved, fence stage absent.

- [ ] **Step 3: Write minimal implementation** — per Interfaces: fence stage first (`try { const { evaluateFenceForWrite } = await import("@megasaver/fence"); … } catch { /* fail-open */ }`), fence deny → ledger row + deny wire (verbatim shape of guard-run.ts:212-219 with `permissionDecisionReason: fence.text`), fence warn → ledger row + carry into compose; then the extracted `firewallStage`; single tail `return composeGuardOutputs(...)` with PHF's `pkgText` passed as `packageFirewallText` and `mergeHookOutputs` deleted (absorption note above). Add `@megasaver/fence` to `apps/cli/package.json` devDependencies (workspace:*, bundle pattern), add `"@megasaver/fence"` to `ALLOWED_MEGA_DEPENDENCIES` in `apps/cli/test/dependency-graph.test.ts`, and `pnpm install`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test hooks && pnpm --filter @megasaver/cli test dependency-graph && pnpm --filter @megasaver/cli typecheck`
Expected: PASS, including ALL pre-existing `guard-run.test.ts` cases unchanged (refactor regression gate) and the dependency-graph allow-list suite; PHF's compose assertions pass re-pointed at `composeGuardOutputs`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli pnpm-lock.yaml
git commit -m "feat(cli): fence stage in guard hook"
```

---

### Task 7: `mega fence init [--write]`

**Files:**
- Create: `apps/cli/src/commands/fence/init.ts`, `apps/cli/src/commands/fence/index.ts`, `packages/fence/src/write.ts` (atomic writer + Document-API append)
- Modify: `packages/fence/src/index.ts`
- Test: `apps/cli/test/commands/fence-init.test.ts`, `packages/fence/test/write.test.ts`

**Interfaces:**
- Produces (`packages/fence/src/write.ts`):

```ts
// tmp+rename atomic write, mirroring atomicWriteFile (packages/content-store/src/atomic-write.ts:21)
// but package-local: @megasaver/fence must not grow a content-store edge. fence.yaml
// is a USER-OWNED committed file: plain 0o644-family default modes, no 0o600 chmod.
export function writeFenceFileAtomic(dir: string, file: FenceFile): void;
// yaml Document API: appends entries to the existing document's `entries` seq and
// NOTHING else — user comments, key order, and formatting outside the appended
// nodes survive byte-for-byte. Validates the mutated doc via parseFenceFile
// BEFORE writing; never writes an invalid file.
export function appendFenceEntries(dir: string, additions: readonly FenceEntry[]): void;
```

- Produces (`apps/cli/src/commands/fence/init.ts`) — house cli-test-pattern (`run<Cmd>(input): Promise<0|1>`, injected cwd/stdout/stderr, mirroring `RunGuardMuteInput` in `apps/cli/src/commands/guard/mute.ts`):

```ts
export type RunFenceInitInput = {
  cwd: string;
  write: boolean;
  seams?: DeriveSeams; // tests inject; default createDefaultDeriveSeams(root)
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export async function runFenceInit(input: RunFenceInitInput): Promise<0 | 1>;
```

- Behavior: init root = nearest ancestor of `cwd` containing `.git`, else `cwd` itself. Fresh repo (no `fence.yaml`): derive → print one line per entry (`<path>  <class>  <reason>`), skipped gitattributes patterns (`skipped: <pattern> — <reason>`), degraded signals (`no git — skipped signals: …`); `--write` → `writeFenceFileAtomic`. Existing `fence.yaml`: parse LOUDLY (`FenceError` → message on stderr, exit 1); additive-suggest — additions = derived entries whose `path` is not already present; print `suggested additions:` list or `no new entries`; `--write` → `appendFenceEntries` only (never removes, never re-modes, never touches `allow`). Derivation over cap (`FenceError` from `deriveFence`) → report on stderr, exit 1. ASSUMPTION: over-cap derivation refuses to write rather than truncating — fail-visible over silent trim, mirroring policy I3 (`parse-project-permissions.ts` cap comment); spec fixes the caps but not the overflow behavior.
- `fence/index.ts`: citty `defineCommand` group mirroring `apps/cli/src/commands/guard/index.ts` (registration in main.ts happens in Task 8 together with the other subcommands).

- [ ] **Step 1: Write the failing tests** — `packages/fence/test/write.test.ts`: atomic write round-trips through `loadFenceFile`; `appendFenceEntries` on a hand-written file with comments:

```ts
// packages/fence/test/write.test.ts (comment-preservation core)
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

it("appendFenceEntries preserves comments and existing formatting", () => {
  writeFileSync(join(root, "fence.yaml"), HAND_WRITTEN);
  appendFenceEntries(root, [
    { path: "vendor/**", class: "vendored", reason: "derived: vendored dir" },
  ]);
  const after = readFileSync(join(root, "fence.yaml"), "utf8");
  expect(after).toContain("# our fence — reviewed 2026-08-06");
  expect(after).toContain("# keep first");
  expect(after).toContain("vendor/**");
  expect(after.indexOf("pnpm-lock.yaml")).toBeLessThan(after.indexOf("vendor/**"));
});
```

  `apps/cli/test/commands/fence-init.test.ts`: temp repo with REAL fixtures — `mkdirSync(join(repo, ".git"))`, `pnpm-lock.yaml`, `dist/bundle.js`, `src/gen/api.ts` starting `// @generated — DO NOT EDIT`, `.gitattributes` containing `legacy/[ab].ts linguist-generated`, `vendor/lib.js` — injected seams built over the fixture list (sorted). Cases: (1) dry run prints all classes + the bracket skip, writes nothing; (2) `--write` creates `fence.yaml` that `loadFenceFile` parses, re-run prints `no new entries` and leaves the file BYTE-IDENTICAL; (3) new fixture file appears → re-run suggests exactly one addition, `--write` appends and preserves a comment seeded into the file; (4) corrupt existing `fence.yaml` → stderr message, exit 1, file untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/fence test write && pnpm --filter @megasaver/cli test fence-init`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation** — per Interfaces. Core of `appendFenceEntries` (the comment-preserving Document-API mutation):

```ts
import { parseDocument, YAMLSeq } from "yaml";

export function appendFenceEntries(dir: string, additions: readonly FenceEntry[]): void {
  const path = join(dir, FENCE_FILE_NAME);
  const doc = parseDocument(readFileSync(path, "utf8"));
  const entries = doc.get("entries");
  if (!(entries instanceof YAMLSeq)) throw new FenceError("schema_invalid", "entries is not a sequence");
  for (const entry of additions) entries.add(doc.createNode(entry));
  parseFenceFile(doc.toJS()); // validate BEFORE writing; throws FenceError on invalid
  writeTmpThenRename(path, doc.toString()); // same tmp+rename as writeFenceFileAtomic
}
```

  `runFenceInit`'s additive-suggest flow: `existing = loadFenceFile(root)` (LOUD `FenceError` → stderr + exit 1); `derived = deriveFence(seams)`; `additions = derived.file.entries.filter((e) => !existingPaths.has(e.path))`; print each addition (or `no new entries`), skipped patterns, degraded signals; `--write` → fresh file ? `writeFenceFileAtomic(root, derived.file)` : `appendFenceEntries(root, additions)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/fence test && pnpm --filter @megasaver/cli test fence-init`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fence apps/cli
git commit -m "feat(cli): mega fence init"
```

---

### Task 8: `mega fence allow / status / check` + command registration

**Files:**
- Create: `apps/cli/src/commands/fence/allow.ts`, `apps/cli/src/commands/fence/status.ts`, `apps/cli/src/commands/fence/check.ts`
- Modify: `apps/cli/src/commands/fence/index.ts`, `apps/cli/src/main.ts` (add `fence: fenceCommand` to `subCommands`, main.ts:60), `packages/fence/src/write.ts` (add `appendFenceAllow`)
- Test: `apps/cli/test/commands/fence.test.ts`

**Interfaces:**
- `runFenceAllow({ cwd, path, stdout, stderr }): Promise<0 | 1>` — `locateFenceRoot(cwd)`; none → stderr `no fence.yaml found — run: mega fence init --write`, exit 1. Normalizes the argument via `normalizeFencePath`. Read-modify-write under `withFileLock` from `@megasaver/shared/node` (`packages/shared/src/file-lock.ts:25`), lock path `<fenceRoot>/fence.yaml.lock`, options `{ deadlineMs: 1_000, staleMs: 10_000 }` — ASSUMPTION: no house value exists for an interactive command (brain-sync's hot path uses `{ deadlineMs: 50, staleMs: 5000 }`, `packages/brain-sync/src/config.ts:72`); 1 s is generous for a human-invoked mutation, 10 s stale bound follows the same order of magnitude. Inside the lock: `appendFenceAllow` (Document API, comment-preserving, validates before atomic write). Duplicate allow → `already allowed: <path>`, exit 0, file untouched. Lock not acquired → stderr, exit 1 (never a partial write).
- `runFenceStatus({ cwd, stdout, stderr }): Promise<0 | 1>` — diagnosis surface: no fence → note + exit 0 (absence is a valid state); parse error → LOUD `FenceError` message + exit 1; valid → fence root path, entry counts per class, warn/deny counts, allow count.
- `runFenceCheck({ cwd, path, json, storeFlag, stdout, stderr }): Promise<0 | 1>` — wrapper dialect: evaluates like the hook but LOUD on parse errors (exit 1 — for a wrapper both "fenced" and "broken fence" mean don't write; fail-closed). Exit 0 = allowed, 1 = fenced. `--json` emits one stable object: `{"path":"…","verdict":"allowed"|"warn"|"deny","class":…,"reason":…,"alternative":…}`. On a fenced verdict, appends the matching `fence-warn`/`fence-deny` ledger row best-effort via `appendFirewallEvent` with `resolveStorePath(readStoreEnv(storeFlag))` — spec Goal sentence "Every warn/deny appends to the firewall ledger"; ASSUMPTION: the architecture diagram draws the ledger only under the guard branch, so this extends it to the check dialect deliberately (best-effort, value-free, cannot fail the check).
- citty wiring mirrors `apps/cli/src/commands/guard/index.ts`; runner functions exported for tests (cli-test-pattern).

- [ ] **Step 1: Write the failing test** — `apps/cli/test/commands/fence.test.ts`: temp repo + `fence.yaml` fixture from Task 6; collector arrays for stdout/stderr. Cases: allow appends and preserves a seeded comment; allow is idempotent (second run exit 0, file byte-identical); allow with no fence → exit 1; status happy-path lists `lockfile 1 / build-output 1 (deny 1) / allow 1`; status on corrupt file → exit 1 with the FenceError message; check exit codes (`src/app.ts` → 0; `pnpm-lock.yaml` → 1; corrupt fence → 1); check `--json` shape exact via `JSON.parse`; check on a fenced path appends one ledger row to `firewallLogPath(storeRoot)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test "test/commands/fence.test.ts"`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation** — per Interfaces; register `fence: fenceCommand` in `apps/cli/src/main.ts` `subCommands` (main.ts:60, alphabetical-ish placement near `firewall`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test fence && pnpm --filter @megasaver/cli typecheck`
Expected: PASS. Smoke (capture for DoD §5): `pnpm --filter @megasaver/cli build && node apps/cli/dist/cli.js fence init` inside this repo (`dist/cli.js` is the verified build entry per `apps/cli/tsup.config.ts` — there is no `dist/main.js`) — MegaSaver itself derives at least `pnpm-lock.yaml` (lockfile) and `dist/**` dirs (dogfood evidence).

- [ ] **Step 5: Commit**

```bash
git add apps/cli packages/fence
git commit -m "feat(cli): mega fence allow, status, check"
```

---

### Task 9: FENCE sentinel block in connectors-shared

**Files:**
- Create: `packages/connectors/shared/src/fence-block.ts`
- Modify: `packages/connectors/shared/src/constants.ts`, `packages/connectors/shared/src/upsert.ts`, `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/fence-block.test.ts`

**Interfaces:**
- New constants (append to `packages/connectors/shared/src/constants.ts`, house pattern lines 1-8):

```ts
export const MEGA_SAVER_FENCE_BLOCK_START = "<!-- MEGA SAVER:FENCE BEGIN -->";
export const MEGA_SAVER_FENCE_BLOCK_END = "<!-- MEGA SAVER:FENCE END -->";
```

- `renderFenceBlockText(input: { entries: ReadonlyArray<{ path: string; class: string; mode?: "warn" | "deny" | undefined; alternative?: string | undefined }> }): string` — STRUCTURAL input (connectors-shared takes no `@megasaver/fence` dep; precedent: pro-analytics `FirewallEventInput`). Renders: heading `# Generated-file fence`, one line per entry `- \`<path>\` (<class>[, DENY]) — <alternative>`, hard cap 20 entries then `…and N more — see fence.yaml`, footer naming `mega fence allow <path>`. Every `path`/`alternative` runs through `containsSentinel` (`packages/connectors/shared/src/sentinel-guard.ts:31`) → `ConnectorError` on a hit (same guard as `renderWarmStartBlockText`, `warm-start-block.ts:8-13`).
- `upsertBlock` (`packages/connectors/shared/src/upsert.ts:31`) gains `fenceBlock?: string` on `UpsertBlockInput` (upsert.ts:14-19) with the warm-start contract verbatim: `undefined` = leave any existing FENCE block untouched; `""` = remove; text = upsert. Applied via the existing `applyOptionalBlock` under a `FENCE_SENTINELS` pair as stage 4, after the WS stage (upsert.ts:43-47). Cursor frontmatter-preservation contract untouched (header seeded once by the connector; only sentinel interiors rewritten).

- [ ] **Step 1: Write the failing test** — mirror `packages/connectors/shared/test/warm-start-block.test.ts` structure:

```ts
// packages/connectors/shared/test/fence-block.test.ts
import { describe, expect, it } from "vitest";
import { MEGA_SAVER_FENCE_BLOCK_END, MEGA_SAVER_FENCE_BLOCK_START } from "../src/constants.js";
import { renderFenceBlockText } from "../src/fence-block.js";
import { upsertBlock } from "../src/upsert.js";
import { buildContext } from "./fixtures.js";

const ENTRIES = [
  { path: "pnpm-lock.yaml", class: "lockfile", alternative: "run `pnpm install` instead" },
  { path: "dist/**", class: "build-output", mode: "deny" as const },
];

describe("renderFenceBlockText", () => {
  it("wraps entries in FENCE sentinels with alternatives and the override hint", () => {
    const block = renderFenceBlockText({ entries: ENTRIES });
    expect(block.startsWith(MEGA_SAVER_FENCE_BLOCK_START)).toBe(true);
    expect(block).toContain("`pnpm-lock.yaml` (lockfile)");
    expect(block).toContain("pnpm install");
    expect(block).toContain("DENY");
    expect(block).toContain("mega fence allow");
    expect(block.trimEnd().endsWith(MEGA_SAVER_FENCE_BLOCK_END)).toBe(true);
  });
  it("caps the listing at 20 entries", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ path: `gen/${i}.ts`, class: "codegen-header" }));
    const block = renderFenceBlockText({ entries: many });
    expect(block).toContain("gen/19.ts");
    expect(block).not.toContain("gen/20.ts");
    expect(block).toContain("and 3 more — see fence.yaml");
  });
  it("rejects sentinel-containing input", () => {
    expect(() =>
      renderFenceBlockText({ entries: [{ path: MEGA_SAVER_FENCE_BLOCK_END, class: "vendored" }] }),
    ).toThrow();
  });
});

describe("upsertBlock fenceBlock pass", () => {
  it("inserts, replaces in place, leaves untouched on undefined, removes on empty", () => {
    const first = upsertBlock({
      existingContent: "intro\n", context: buildContext({}),
      fenceBlock: renderFenceBlockText({ entries: ENTRIES }),
    });
    expect(first).toContain("pnpm-lock.yaml");
    const untouched = upsertBlock({ existingContent: first, context: buildContext({}) });
    expect(untouched).toContain("pnpm-lock.yaml");
    const replaced = upsertBlock({
      existingContent: first, context: buildContext({}),
      fenceBlock: renderFenceBlockText({ entries: [ENTRIES[1]!] }),
    });
    expect(replaced).not.toContain("pnpm-lock.yaml");
    expect(replaced.split(MEGA_SAVER_FENCE_BLOCK_START).length - 1).toBe(1);
    const removed = upsertBlock({ existingContent: first, context: buildContext({}), fenceBlock: "" });
    expect(removed).not.toContain(MEGA_SAVER_FENCE_BLOCK_START);
    expect(removed).toContain("intro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connectors-shared test fence-block`
Expected: FAIL — constants/module/param missing.

- [ ] **Step 3: Write minimal implementation** — per Interfaces; export `renderFenceBlockText`, the sentinel pair, and the widened input from `packages/connectors/shared/src/index.ts` (beside the WS exports, index.ts:33).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/connectors-shared test`
Expected: PASS, including all pre-existing upsert/warm-start/handoff tests (independent-pair invariant).

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/shared
git commit -m "feat(connectors): FENCE sentinel block"
```

---

### Task 10: `mega connector sync` fence wiring + integration smoke

**Files:**
- Modify: `apps/cli/src/commands/connector/sync.ts`
- Test: `apps/cli/test/commands/connector-fence-sync.test.ts`

**Interfaces:**
- Consumes: `runConnectorSync` (`apps/cli/src/commands/connector/sync.ts:45`), the per-target loop writing `join(project.rootPath, target.relativePath)` (sync.ts:87), both `upsertBlock` call sites (seed/"created" and update paths — the warm-start wiring at sync.ts:120-144 is the template), `loadFenceFile` from `@megasaver/fence` (lazy `await import` per decisions/lazy-load-heavy-deps — precedent: `apps/cli/src/commands/firewall.ts:83`; sync.ts itself has no lazy import yet), `renderFenceBlockText` from `@megasaver/connectors-shared`, `builtinTargets` (`packages/connectors/generic-cli/src/targets.ts:69`), `CLAUDE_CODE_TARGET` (`apps/cli/src/known-targets.ts:12`).
- Behavior: once per sync run, before the target loop — load `fence.yaml` from `project.rootPath`; absent → `fenceBlock = ""` (removes a stale block); present+valid → `fenceBlock = renderFenceBlockText({ entries: file.entries.map((e) => ({ path: e.path, class: e.class, mode: e.mode, alternative: e.alternative })) })` — the mapper resolves per-class default alternatives via `fenceAlternative` so flat files carry guidance; `FenceError` (corrupt file) → `fenceBlock = undefined` and one stderr note. ASSUMPTION: on a corrupt fence.yaml sync leaves existing FENCE blocks untouched rather than removing them — spec fixes only the absent→`""` case, and removing enforcement text because the file is broken would be fail-open; `mega fence status` is the loud surface. Per target: pass `fenceBlock` only for flat-file targets — `target.id !== CLAUDE_CODE_TARGET.id` (Claude Code's dialect is the hook; a block would double-deliver, spec Locked Decision 9).
- Open question 1 from the spec (stronger wording for deny entries in flat files) is answered minimally here: deny entries render with the `DENY` tag from Task 9 — text-only, no new mechanism.

- [ ] **Step 1: Write the failing test** — follow the `apps/cli/test/connector-preflight-callsite.test.ts` store/project setup style (temp store + project rooted at a temp dir): seed a project whose root contains `fence.yaml` (Task 6 fixture) plus an existing `AGENTS.md` and `.cursor/rules/megasaver.mdc` with hand-kept text outside sentinels. Run `runConnectorSync`. Assert: (1) `AGENTS.md` gains exactly one FENCE sentinel pair containing `pnpm-lock.yaml` and the `DENY` tag; (2) `.cursor/rules/megasaver.mdc` keeps its frontmatter and hand-kept text outside sentinels byte-identical while gaining the FENCE block; (3) `CLAUDE.md` (claude-code target) gains NO FENCE sentinels; (4) delete `fence.yaml`, re-run → FENCE blocks removed from flat files, hand-kept text intact; (5) corrupt `fence.yaml`, re-run → blocks left untouched, one stderr note, exit code still reflects target results.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test connector-fence-sync`
Expected: FAIL — no fence wiring.

- [ ] **Step 3: Write minimal implementation** — per Interfaces. The fenceBlock computation, once per run before the target loop:

```ts
let fenceBlock: string | undefined = "";
try {
  const { fenceAlternative, loadFenceFile } = await import("@megasaver/fence");
  const fenceFile = loadFenceFile(project.rootPath);
  if (fenceFile !== null && fenceFile.entries.length > 0) {
    fenceBlock = renderFenceBlockText({
      entries: fenceFile.entries.map((e) => ({
        path: e.path, class: e.class, mode: e.mode,
        alternative: e.alternative ?? fenceAlternative(e),
      })),
    });
  }
} catch {
  fenceBlock = undefined; // corrupt fence.yaml: leave existing blocks untouched
  stderr(`fence.yaml unreadable — FENCE blocks left as-is (run: mega fence status)`);
}
```

  Per target inside the loop: `upsertBlock({ …, fenceBlock: target.id === CLAUDE_CODE_TARGET.id ? undefined : fenceBlock })` at both call sites (seed and update paths).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli test connector && pnpm --filter @megasaver/cli typecheck`
Expected: PASS, including every pre-existing connector suite (frontmatter/outside-sentinel preservation).

- [ ] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): fence block in connector sync"
```

---

### Task 11: Changeset, wiki, full verify

**Files:**
- Create: `.changeset/generated-file-fence.md`, `wiki/` page for the fence feature (per the wiki schema in `wiki/CLAUDE.md`)
- Modify: `wiki/log.md` (timestamped entry), `wiki/index.md` (catalog line)

**Interfaces:**
- Changeset covers every package with a public-surface change: `@megasaver/fence` (new), `@megasaver/context-gate` (enum + export, minor), `@megasaver/connectors-shared` (`fenceBlock` param + renderer, minor), `@megasaver/cli` (new `mega fence` commands + hook behavior, minor).
- `docs/conventions/` is NOT touched: the fence adds a product feature, no repo convention changed, so no `CLAUDE.md`/`AGENTS.md`/`.cursor` regeneration is due (§7).

- [ ] **Step 1: Write the changeset** describing the four surfaces and the warn-first default.
- [ ] **Step 2: Write the wiki page** (what the fence is, fence.yaml contract, three dialects, ledger kinds, named gaps: Bash writes, gitattributes brackets) and append the `wiki/log.md` entry (§0 mandate).
- [ ] **Step 3: Full verification**

Run: `pnpm verify`
Expected: green (biome + tsc + vitest across the workspace). Re-run the Task 8 CLI smoke and keep the captured session as DoD §5 evidence.

- [ ] **Step 4: Commit**

```bash
git add .changeset wiki
git commit -m "chore(fence): changeset + wiki page"
```

- [ ] **Step 5: Process gates (outside this plan's code steps)** — request `code-reviewer` AND `critic` passes (separate, fresh contexts; author ≠ reviewer), then `verifier` with the smoke evidence, per §9 items 6-7. Merge only after all pass.

---

## Spec coverage & open items

- Spec coverage: fence.yaml schema/caps/locate (§Components 1) → Task 1; gitattributes (§3) → Task 2; derivation signals + determinism (§2) → Task 3; evaluation precedence + texts (§4) → Task 4; ledger kinds + reader meaning (§Locked 7) → Task 5; guard piggyback + wire + ordering + fail-open (§Locked 4-5, §5) → Task 6; CLI init/allow/status/check + Document API + locks (§Locked 2, 8, 10, §6) → Tasks 7-8; connector block (§Locked 9, §7) → Tasks 9-10; testing section mapped 1:1 onto the per-task suites; risk/process (§Risk) → Global Constraints + Task 11.
- ASSUMPTION markers the implementer must resolve or confirm inline: no-slash gitattributes pattern → `**/<p>` (Task 2); over-cap derivation refuses to write (Task 7); `withFileLock` options for the interactive allow path (Task 8); `mega fence check` appends ledger rows (Task 8); corrupt fence.yaml during sync leaves blocks untouched (Task 10).
- Coordination (binding cross-pair contract): this plan OWNS `composeGuardOutputs`; package-hallucination-firewall (Task 8 `mergeHookOutputs`, absorbed by Task 6 here) and session-mesh (Task 9) ADOPT the seam. Composition order is fence → firewall → mesh (mistake-firewall before package-firewall inside the firewall position). If session-mesh Task 9 lands first, rebase Task 6 onto its guard-run shape and wire its text as the mesh input of `composeGuardOutputs`; all changes are additive and independent (spec §Dependencies).
- Spec open questions 1-3 stay open: Q1 is answered minimally by the `DENY` tag (text-only); `bun.lockb` and `check --staged` are follow-ups, not in scope.
