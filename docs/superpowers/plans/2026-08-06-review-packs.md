# Review Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega review pack [<base>..<head>]` builds an evidence-preserving, secret-redacted review pack (semantic diff chunks + enclosing-declaration context + test receipts + claims manifest) persisted as expandable content-store chunk sets, exposed on stdout/`--json` and as the MCP tool `review_pack`.

**Architecture:** A new leaf package `@megasaver/review-pack` (no `@megasaver/core` edge) composes read-only git, the existing `chunkBySemantic` AST chunker, lazy-loaded `@megasaver/indexer` extractors, `policy.redact`, and `saveOverlayChunkSet`. Run receipts are C3-owned: claim-verification-gate (build-order 3) persists an additive-optional `childExitCode` on `tokenSaverEventSchema`/`overlayTokenSaverEventSchema` at the run-command event seams; a thin receipts view in review-pack reads those rows via stats' `readEvents`/`readOverlayEvents` — this pair adds no ledger and makes no context-gate or stats edits. The CLI command and the mcp-bridge tool are thin wrappers over `buildReviewPack`.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Citty, node:child_process `execFileSync` (git), pnpm workspaces + tsup.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-review-packs-design.md`; risk HIGH → worktree `feat/review-packs`, `code-reviewer` AND `critic` passes, no `main` edits.
- Fail-closed git gate: error codes `bad_range | dirty_worktree | empty_diff | git_unavailable | store_write_failed` (alphabetic); exit 1; never a partial pack.
- Redact-first: `redact()` (packages/policy/src/redact.ts:44, `RedactResult = { redacted: string; count: number }`) before every persist and once more over the digest before stdout; all pack chunk sets carry `redacted: true`.
- Pack persistence: three `OverlayChunkSet`s (`<packId>-diff`, `<packId>-context`, `<packId>-manifest`), `workspaceKey = encodeWorkspaceKey(repoTopLevel)` (packages/shared/src/workspace-key.ts:20), `liveSessionId = review-<packId>`, `source = { kind: "command", command: "mega", args: ["review", "pack", <rangeLabel>] }` — no content-store schema change.
- Receipts: READ-ONLY consumption of `sourceKind: "command"` `TokenSaverEvent`/`OverlayTokenSaverEvent` rows carrying `childExitCode` — owned by claim-verification-gate (build-order 3), written at the run-command event constructions (packages/context-gate/src/run-command.ts:433/679; `result.chunkSetId`, set at 402/668, rides into the rows' `chunkSetId`). This plan makes NO context-gate or stats-schema edits. BLOCKED BY claim-verification-gate for exit-carrying rows; rows without `childExitCode` degrade to "receipt without exit code" (spec Non-Goals + Dependencies).
- Git subprocess defaults: `execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000, maxBuffer: 10 * 1024 * 1024 })` — mirrors apps/cli/src/git-delta.ts:7-14; injectable `ExecGit = (args: string[], cwd: string) => string`.
- Heavy deps: `@megasaver/indexer` only via cached dynamic `import()` (wiki/decisions/lazy-load-heavy-deps); guard test mirrors packages/output-filter/test/no-eager-typescript.test.ts.
- No timing-tight tests; determinism via injected `now` / `newId` / `execGit` / temp fixture repos (wiki/workflows/cli-test-pattern.md).
- Every commit: conventional format (§10), subject ≤ 50 chars, `pnpm exec biome check <changed files>` + package tests green before commit.

---

### Task 1: export `chunkBySemantic` + `Chunk` from output-filter

**Files:**
- `packages/output-filter/src/index.ts` (edit)
- `packages/output-filter/test/public-surface.test.ts` (new)

**Interfaces:** re-exports only — `chunkBySemantic(text: string, path: string): Promise<Chunk[] | null>` (packages/output-filter/src/parsers/semantic.ts:124) and `type Chunk = { text: string; startLine: number; endLine: number }` (packages/output-filter/src/rank.ts:44). `chunkByLines` is already public (index.ts:1).

**Steps:**

- [ ] Write the failing test `packages/output-filter/test/public-surface.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { chunkBySemantic } from "../src/index.js";

describe("public surface", () => {
  it("exposes chunkBySemantic and returns declaration-aligned chunks", async () => {
    const src = "export function alpha(): number {\n  return 1;\n}\n\nexport function beta(): number {\n  return 2;\n}\n";
    const chunks = await chunkBySemantic(src, "sample.ts");
    expect(chunks).not.toBeNull();
    expect(chunks?.some((c) => c.text.includes("alpha"))).toBe(true);
  });

  it("returns null for an unsupported extension", async () => {
    expect(await chunkBySemantic("x", "sample.xyz")).toBeNull();
  });
});
```
- [ ] Run `pnpm --filter @megasaver/output-filter test -- public-surface` — expect FAIL: `chunkBySemantic` not exported from `src/index.js`.
- [ ] Implement: add to `packages/output-filter/src/index.ts`:
```ts
export { chunkBySemantic } from "./parsers/semantic.js";
export type { Chunk } from "./rank.js";
```
- [ ] Run the test — PASS; run `pnpm --filter @megasaver/output-filter test` (the existing `no-eager-typescript.test.ts` must stay green — the export is a re-export of an already-lazy module, so no eager compiler load).
- [ ] Commit: `feat(output-filter): export chunkBySemantic`

---

### Task 2: scaffold `@megasaver/review-pack` — errors + git module

**Files:**
- `packages/review-pack/package.json`, `packages/review-pack/tsconfig.json` (new; copy shape from `packages/content-store/*` — leaf precedent)
- `packages/review-pack/src/errors.ts`, `packages/review-pack/src/git.ts`, `packages/review-pack/src/index.ts` (new)
- `packages/review-pack/test/git.test.ts`, `packages/review-pack/test/dependency-direction.test.ts` (new)

**Interfaces:**
```ts
// errors.ts
export const reviewPackErrorCodeSchema: z.ZodEnum<["bad_range", "dirty_worktree", "empty_diff", "git_unavailable", "store_write_failed"]>;
export type ReviewPackErrorCode = z.infer<typeof reviewPackErrorCodeSchema>;
export class ReviewPackError extends Error {
  constructor(readonly code: ReviewPackErrorCode, message: string, options?: { cause?: unknown });
}

// git.ts
export type ExecGit = (args: string[], cwd: string) => string;
export const defaultExecGit: ExecGit;                       // git-delta.ts:7-14 defaults
export type LineRange = { start: number; end: number };     // 1-based, inclusive, new-file coords
export type RangeInfo = { baseSha: string; headSha: string; label: string };
export type CommitInfo = { sha: string; subject: string; committedAt: string };
export type ChangedFile = { path: string; status: "A" | "D" | "M" | "R" };
export function repoTopLevel(cwd: string, execGit: ExecGit): string | null;          // rev-parse --show-toplevel
export function assertCleanTree(repoRoot: string, execGit: ExecGit): void;           // throws dirty_worktree | git_unavailable
export function resolveRange(repoRoot: string, range: string | undefined, execGit: ExecGit): RangeInfo; // throws bad_range
export function listCommits(repoRoot: string, r: RangeInfo, execGit: ExecGit): CommitInfo[];
export function listChangedFiles(repoRoot: string, r: RangeInfo, execGit: ExecGit): ChangedFile[];      // diff --name-status -z
export function unifiedDiff(repoRoot: string, r: RangeInfo, execGit: ExecGit): string;
export function fileAtHead(repoRoot: string, headSha: string, path: string, execGit: ExecGit): string | null; // show, null when absent
export function changedLineRanges(repoRoot: string, r: RangeInfo, path: string, execGit: ExecGit): LineRange[]; // --unified=0 hunk headers
```
`resolveRange` parses `<base>..<head>` when given; otherwise resolves the default branch by the exact chain in apps/cli/src/git-delta.ts:26-36 (`symbolic-ref refs/remotes/origin/HEAD`, then `main`, then `master`) and takes `merge-base(defaultBranch, HEAD)..HEAD`; no default branch → `bad_range`.

**Steps:**

- [ ] Create `package.json` (name `@megasaver/review-pack`, version `0.1.0`, ESM, deps: `@megasaver/shared`, `@megasaver/policy`, `@megasaver/output-filter`, `@megasaver/content-store`, `@megasaver/stats`, `@megasaver/indexer`, `zod` — all `workspace:*` except zod) and `tsconfig.json` extending `tsconfig.base.json` with project references matching the dep list; run `pnpm install` so workspace symlinks exist.
- [ ] Write the failing test `packages/review-pack/test/git.test.ts` with a REAL temp fixture repo:
```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewPackError } from "../src/errors.js";
import {
  assertCleanTree,
  changedLineRanges,
  defaultExecGit,
  fileAtHead,
  listChangedFiles,
  listCommits,
  repoTopLevel,
  resolveRange,
  unifiedDiff,
} from "../src/git.js";

// Hermetic git: no user/system config, deterministic author.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(tmpdir(), "megasaver-no-gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_DATE: "2026-08-06T10:00:00Z",
  GIT_COMMITTER_DATE: "2026-08-06T10:00:00Z",
};
const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });

function initFixtureRepo(dir: string): void {
  git(dir, "init");
  git(dir, "checkout", "-b", "main");
  git(dir, "config", "user.email", "test@megasaver.dev");
  git(dir, "config", "user.name", "Test");
  writeFileSync(
    join(dir, "alpha.ts"),
    "export function alpha(): number {\n  return 1;\n}\n",
  );
  git(dir, "add", "alpha.ts");
  git(dir, "commit", "-m", "feat(core): seed alpha");
}

describe("review-pack git module", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-rp-git-"));
    initFixtureRepo(repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("resolves top level and passes the clean-tree gate", () => {
    expect(repoTopLevel(repo, defaultExecGit)).toBe(git(repo, "rev-parse", "--show-toplevel").trim());
    expect(() => assertCleanTree(repo, defaultExecGit)).not.toThrow();
  });

  it("fails closed on a dirty worktree", () => {
    writeFileSync(join(repo, "alpha.ts"), "// dirty\n");
    expect(() => assertCleanTree(repo, defaultExecGit)).toThrow(ReviewPackError);
    try {
      assertCleanTree(repo, defaultExecGit);
    } catch (err) {
      expect((err as ReviewPackError).code).toBe("dirty_worktree");
    }
  });

  it("resolves a feature range and reads commits, files, hunks", () => {
    git(repo, "checkout", "-b", "feat/x");
    writeFileSync(
      join(repo, "alpha.ts"),
      "export function alpha(): number {\n  return 42;\n}\n",
    );
    git(repo, "add", "alpha.ts");
    git(repo, "commit", "-m", "fix(core): alpha returns 42");
    const range = resolveRange(repo, "main..HEAD", defaultExecGit);
    expect(listCommits(repo, range, defaultExecGit).map((c) => c.subject)).toEqual([
      "fix(core): alpha returns 42",
    ]);
    expect(listChangedFiles(repo, range, defaultExecGit)).toEqual([
      { path: "alpha.ts", status: "M" },
    ]);
    expect(changedLineRanges(repo, range, "alpha.ts", defaultExecGit)).toEqual([
      { start: 2, end: 2 },
    ]);
    expect(unifiedDiff(repo, range, defaultExecGit)).toContain("-  return 1;");
    expect(fileAtHead(repo, range.headSha, "alpha.ts", defaultExecGit)).toContain("return 42");
  });

  it("throws bad_range on an unresolvable range", () => {
    expect(() => resolveRange(repo, "nope..HEAD", defaultExecGit)).toThrow(ReviewPackError);
  });

  it("throws git_unavailable outside a repo", () => {
    const plain = mkdtempSync(join(tmpdir(), "megasaver-rp-plain-"));
    try {
      expect(() => assertCleanTree(plain, defaultExecGit)).toThrow(ReviewPackError);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
```
- [ ] Write the failing guard test `packages/review-pack/test/dependency-direction.test.ts` (mirror the shape of `packages/content-store` dependency test — read `packages/review-pack/src/**` sources and assert no `@megasaver/core` import string, and no top-level static `@megasaver/indexer` import outside a dynamic `import(`).
- [ ] Run `pnpm --filter @megasaver/review-pack test` — expect FAIL: modules missing.
- [ ] Implement `src/errors.ts` and `src/git.ts`. Core mechanics: `assertCleanTree` = `status --porcelain -z` (throw `git_unavailable` when the subprocess throws; `dirty_worktree` when output trimmed is non-empty). `resolveRange` = `rev-parse --verify <base>` / `<head>` (throw `bad_range` on any throw), default chain per Interfaces. `changedLineRanges` parses `@@ -a,b +c,d @@` headers from `diff --unified=0 <base>..<head> -- <path>` (`d === 0` → deletion-only hunk, skip; else `{ start: c, end: c + d - 1 }`). `listCommits` uses `log --format=%H%x09%s%x09%cI <base>..<head>` (tab-split, the git-delta.ts:79 idiom). `fileAtHead` = `show <headSha>:<path>`, `null` on throw. `defaultExecGit` copies git-delta.ts:7-14 verbatim.
- [ ] `src/index.ts` re-exports the errors + git surface.
- [ ] Run `pnpm --filter @megasaver/review-pack test` — expect PASS; `pnpm --filter @megasaver/review-pack typecheck`.
- [ ] Commit: `feat(review-pack): scaffold errors and git module`

---

### Task 3: semantic diff chunks + enclosing context extents

**Files:**
- `packages/review-pack/src/semantic-diff.ts`, `packages/review-pack/src/context-extents.ts` (new)
- `packages/review-pack/test/semantic-diff.test.ts`, `packages/review-pack/test/context-extents.test.ts` (new)

**Interfaces:**
```ts
// semantic-diff.ts
import type { Chunk } from "@megasaver/output-filter"; // exported in Task 1
export function overlaps(chunk: { startLine: number; endLine: number }, ranges: readonly LineRange[]): boolean;
export async function semanticDiffChunks(input: {
  path: string;
  headText: string;
  ranges: readonly LineRange[];
}): Promise<Chunk[]>; // chunkBySemantic(headText, path); null → chunkByLines(headText, 40); keep only overlapping chunks

// context-extents.ts
export type ContextExtent = { path: string; startLine: number; endLine: number; name?: string; blockType?: string; text: string };
export const FALLBACK_WINDOW = 20;
export async function enclosingExtents(input: {
  path: string;
  headText: string;
  ranges: readonly LineRange[];
}): Promise<ContextExtent[]>;
```
`enclosingExtents` lazily imports `@megasaver/indexer` (cached promise, the packages/output-filter/src/parsers/semantic.ts:12-21 idiom), dispatches `extractTs` (.ts/.mts/.cts/.tsx/.jsx/.js/.mjs/.cjs) / `extractMd` (.md) / `extractJson` (.json) — signatures per wiki/entities/indexer (`extractTs(filePath, source)` → `ExtractedBlock[]`, `Omit<CodeBlock, "id" | "projectId">` with `startLine`/`endLine`/`blockType`/`name?`, packages/indexer/src/code-block.ts:61) — and returns the FULL extent of every block overlapping any range (deduped, ordered by startLine). Unsupported extension, extractor throw, or zero blocks → one ±`FALLBACK_WINDOW`-line window per range, clamped to file bounds, merged when overlapping.

**Steps:**

- [ ] Write failing `test/semantic-diff.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { semanticDiffChunks } from "../src/semantic-diff.js";

const TWO_FNS =
  "export function alpha(): number {\n  return 1;\n}\n\nexport function beta(): number {\n  return 2;\n}\n";

describe("semanticDiffChunks", () => {
  it("keeps only declaration chunks overlapping the changed ranges", async () => {
    const chunks = await semanticDiffChunks({
      path: "alpha.ts",
      headText: TWO_FNS,
      ranges: [{ start: 6, end: 6 }], // inside beta only
    });
    expect(chunks.some((c) => c.text.includes("beta"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("alpha("))).toBe(false);
  });

  it("falls back to line chunks for unsupported extensions", async () => {
    const chunks = await semanticDiffChunks({
      path: "notes.xyz",
      headText: "l1\nl2\nl3\n",
      ranges: [{ start: 2, end: 2 }],
    });
    expect(chunks).toHaveLength(1); // one 40-line window covers it
  });
});
```
- [ ] Write failing `test/context-extents.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FALLBACK_WINDOW, enclosingExtents } from "../src/context-extents.js";

const LONG_FN = `export function gamma(): number {\n${"  // pad\n".repeat(120)}  return 3;\n}\n`;

describe("enclosingExtents", () => {
  it("returns the FULL enclosing declaration, not a sub-split slice", async () => {
    const extents = await enclosingExtents({
      path: "gamma.ts",
      headText: LONG_FN,
      ranges: [{ start: 60, end: 60 }],
    });
    expect(extents).toHaveLength(1);
    expect(extents[0]?.startLine).toBe(1);
    expect(extents[0]?.endLine).toBeGreaterThan(100); // whole 120+ line fn, unsplit
    expect(extents[0]?.name).toBe("gamma");
  });

  it("windows unsupported files around the hunk", async () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const extents = await enclosingExtents({
      path: "data.txt",
      headText: text,
      ranges: [{ start: 50, end: 50 }],
    });
    expect(extents[0]?.startLine).toBe(50 - FALLBACK_WINDOW);
    expect(extents[0]?.endLine).toBe(50 + FALLBACK_WINDOW);
  });
});
```
- [ ] Run `pnpm --filter @megasaver/review-pack test -- semantic-diff context-extents` — expect FAIL: modules missing.
- [ ] Implement both modules. `semanticDiffChunks`: `const chunks = (await chunkBySemantic(input.headText, input.path)) ?? chunkByLines(input.headText, 40); return chunks.filter((c) => overlaps(c, input.ranges));`. `overlaps` = interval intersection (`c.startLine <= r.end && c.endLine >= r.start`). `enclosingExtents`: extension dispatch table → lazy extractor call inside `try` → overlap filter over raw blocks → map to `ContextExtent` slicing `headText` lines `[startLine-1, endLine)`; fallback windows on `null` path.
- [ ] Run the two suites — PASS; re-run `test/dependency-direction.test.ts` (still no static indexer import).
- [ ] Commit: `feat(review-pack): semantic diff and extents`

---

### Task 4: receipts view over C3-owned event rows

**Files:**
- `packages/review-pack/src/receipts.ts` (new)
- `packages/review-pack/test/receipts.test.ts` (new)

**Interfaces:**
```ts
import {
  type OverlayTokenSaverEvent,
  type StatsStore, // = { root: string } — packages/stats/src/store.ts:23 (verified)
  type TokenSaverEvent,
  readEvents,
  readOverlayEvents,
} from "@megasaver/stats";
export type ReceiptEvent = TokenSaverEvent | OverlayTokenSaverEvent;
export type ReceiptCandidate = {
  command: string;            // event.label — redacted argv join (run-command.ts:292/580)
  exitCode?: number | null;   // event.childExitCode (C3); absent = pre-C3 row → "receipt without exit code"
  createdAt: string;
  chunkSetId?: string;
};
export const RECEIPT_WINDOW_MINUTES = 1440; // mirrors C3's join-window bound (1..1440)
export function readReceiptEvents(
  store: StatsStore,
  keys: { workspaceKey: string; projectId?: string },
): ReceiptEvent[];
export function receiptCandidatesFromEvents(
  events: readonly ReceiptEvent[],
  opts: { now: string; windowMinutes?: number },
): ReceiptCandidate[];
```
`readReceiptEvents`: overlay side enumerates `<storeRoot>/stats/<workspaceKey>/*.events.jsonl` live-session ids (the readdir idiom stats itself uses internally, store.ts:584) and calls `readOverlayEvents(store, workspaceKey, id)` per id; durable side, only when `projectId` is given, enumerates `stats/<projectId>/*.events.jsonl` the same way and calls `readEvents` (parse ids with `projectIdSchema`/`sessionIdSchema` from `@megasaver/shared` first). Missing dir → `[]`; any read error → `[]` (receipts are optional evidence, spec Error handling). `receiptCandidatesFromEvents`: keep rows with `sourceKind === "command"` and `createdAt` within `windowMinutes` (default `RECEIPT_WINDOW_MINUTES`) of `opts.now`; map `label`→`command`, `childExitCode`→`exitCode` (spread-if-present), carry `chunkSetId`. Rows without `childExitCode` are KEPT with `exitCode` absent — downstream renders "receipt without exit code".

BLOCKED BY claim-verification-gate (build-order 3): `event.childExitCode` exists only after C3's additive-optional schema field lands (packages/stats/src/event.ts); the exit-code mapping and the childExitCode-present test below compile/run only on top of it. The absent-field degradation path runs either way.

**Steps:**

- [ ] Write the failing test `packages/review-pack/test/receipts.test.ts` — write schema-valid overlay event JSONL directly into a temp store, then read through the view:
```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OverlayTokenSaverEvent } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readReceiptEvents, receiptCandidatesFromEvents } from "../src/receipts.js";

const WK = "0123456789abcdef";
const NOW = "2026-08-06T12:00:00.000Z";
const event = (over: Partial<OverlayTokenSaverEvent>): OverlayTokenSaverEvent => ({
  id: "e1",
  liveSessionId: "ls-1",
  workspaceKey: WK,
  createdAt: "2026-08-06T11:00:00.000Z",
  sourceKind: "command",
  label: "pnpm --filter @megasaver/core test",
  rawBytes: 10,
  returnedBytes: 5,
  bytesSaved: 5,
  savingRatio: 0.5,
  summary: "s",
  ...over,
});
const writeEvents = (root: string, rows: OverlayTokenSaverEvent[]): void => {
  mkdirSync(join(root, "stats", WK), { recursive: true });
  writeFileSync(
    join(root, "stats", WK, "ls-1.events.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
};

describe("receipts view", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "megasaver-receipts-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps only in-window command rows and maps childExitCode", () => {
    writeEvents(root, [
      event({ id: "e1", childExitCode: 0 }),
      event({ id: "e2", sourceKind: "file", label: "cat x" }),
      event({ id: "e3", createdAt: "2026-08-01T00:00:00.000Z", childExitCode: 0 }),
    ]);
    const rows = receiptCandidatesFromEvents(readReceiptEvents({ root }, { workspaceKey: WK }), { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exitCode).toBe(0);
    expect(rows[0]?.command).toContain("--filter @megasaver/core");
  });

  it("keeps exit-less rows (pre-C3) with exitCode absent", () => {
    writeEvents(root, [event({ id: "e1" })]); // no childExitCode field
    const rows = receiptCandidatesFromEvents(readReceiptEvents({ root }, { workspaceKey: WK }), { now: NOW });
    expect(rows).toHaveLength(1);
    expect("exitCode" in (rows[0] ?? {})).toBe(false); // renders "receipt without exit code"
  });

  it("returns [] for a missing store dir", () => {
    expect(readReceiptEvents({ root }, { workspaceKey: WK })).toEqual([]);
  });
});
```
- [ ] Run `pnpm --filter @megasaver/review-pack test -- receipts` — expect FAIL: module `../src/receipts.js` not found.
- [ ] Implement `packages/review-pack/src/receipts.ts` per the Interfaces block; re-export the surface from `src/index.ts`.
- [ ] Run `pnpm --filter @megasaver/review-pack test -- receipts` — expect PASS; re-run `test/dependency-direction.test.ts` (stats import is a declared dep, still no `@megasaver/core` edge).
- [ ] Commit: `feat(review-pack): receipts view over events`

---

### Task 5: claims manifest + receipt matching

**Files:**
- `packages/review-pack/src/claims.ts` (new)
- `packages/review-pack/test/claims.test.ts` (new)

**Interfaces:**
```ts
import type { ReceiptCandidate } from "./receipts.js"; // Task 4
export type ReceiptRow = {
  scope: string;                 // "packages/<n>" | "apps/<n>" | "repo"
  command: string;
  exitCode?: number | null;      // absent → rendered "receipt without exit code"
  createdAt: string;
  chunkSetId?: string;
};
export type ClaimsManifest = {
  claims: CommitInfo[];                      // Task 2 type
  packagesTouched: string[];                 // sorted, unique
  receipts: ReceiptRow[];                    // newest per scope
  gaps: string[];                            // touched scopes with no receipt
  warnings: string[];
};
export function packagesForFiles(paths: readonly string[]): string[]; // packages/<n>|apps/<n> prefix, else "repo"
export function buildClaimsManifest(input: {
  commits: readonly CommitInfo[];
  changedPaths: readonly string[];
  receipts: readonly ReceiptCandidate[];
}): ClaimsManifest;
```
Matching rule (locked, deterministic, no judging): a receipt belongs to scope `packages/<n>` when its `command` contains `--filter @megasaver/<n>` or `--filter <n>`; otherwise scope `"repo"` (spec Open Question 1: repo receipts stay one row, no fan-out). Per scope keep only the newest receipt by `createdAt` (tie → later array position wins; the view preserves event append order). A candidate without `exitCode` still fills its scope row — it renders "receipt without exit code" and is NOT a gap (a run happened; only the exit evidence is missing). `gaps` = touched scopes with no matching candidate at all (a repo-scope receipt does NOT clear package gaps).

**Steps:**

- [ ] Write failing `test/claims.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildClaimsManifest, packagesForFiles } from "../src/claims.js";
import type { ReceiptCandidate } from "../src/receipts.js";

const candidate = (command: string, exitCode: number | undefined, at: string): ReceiptCandidate => ({
  command,
  ...(exitCode !== undefined ? { exitCode } : {}),
  createdAt: at,
});

describe("claims manifest", () => {
  it("maps touched files to package scopes", () => {
    expect(
      packagesForFiles(["packages/core/src/a.ts", "apps/cli/src/b.ts", "README.md"]),
    ).toEqual(["apps/cli", "packages/core", "repo"]);
  });

  it("attaches the newest matching receipt per scope and lists gaps", () => {
    const manifest = buildClaimsManifest({
      commits: [{ sha: "abc", subject: "feat(core): thing", committedAt: "2026-08-06T09:00:00Z" }],
      changedPaths: ["packages/core/src/a.ts", "packages/stats/src/b.ts"],
      receipts: [
        candidate("pnpm --filter @megasaver/core test", 1, "2026-08-06T08:00:00.000Z"),
        candidate("pnpm --filter @megasaver/core test", 0, "2026-08-06T09:00:00.000Z"),
        candidate("pnpm verify", 0, "2026-08-06T09:30:00.000Z"),
      ],
    });
    const core = manifest.receipts.find((r) => r.scope === "packages/core");
    expect(core?.exitCode).toBe(0); // newest wins
    expect(manifest.receipts.some((r) => r.scope === "repo")).toBe(true);
    expect(manifest.gaps).toEqual(["packages/stats"]); // repo receipt does not clear it
    expect(manifest.claims[0]?.subject).toBe("feat(core): thing");
  });

  it("an exit-less candidate fills its scope without clearing exit evidence", () => {
    const manifest = buildClaimsManifest({
      commits: [],
      changedPaths: ["packages/core/src/a.ts"],
      receipts: [candidate("pnpm --filter @megasaver/core test", undefined, "2026-08-06T09:00:00.000Z")],
    });
    const core = manifest.receipts.find((r) => r.scope === "packages/core");
    expect(core).toBeDefined();
    expect("exitCode" in (core ?? {})).toBe(false); // renders "receipt without exit code"
    expect(manifest.gaps).toEqual([]); // a run happened — not a gap
  });
});
```
- [ ] Run — expect FAIL (module missing); implement `claims.ts` per the locked rule; run — PASS.
- [ ] Commit: `feat(review-pack): claims manifest`

---

### Task 6: persist + digest + `buildReviewPack` orchestrator

**Files:**
- `packages/review-pack/src/persist.ts`, `packages/review-pack/src/digest.ts`, `packages/review-pack/src/pack.ts` (new)
- `packages/review-pack/src/index.ts` (extend exports)
- `packages/review-pack/test/pack.test.ts` (new)

**Interfaces:**
```ts
// persist.ts — all-or-nothing, redact-before-persist already done by caller
export type PersistDeps = {
  save: typeof saveOverlayChunkSet;      // @megasaver/content-store (store.ts:169)
  remove: typeof deleteOverlayChunkSet;  // exported at content-store/src/index.ts
};
export async function persistPack(input: {
  storeRoot: string; workspaceKey: string; liveSessionId: string; createdAt: string;
  rangeLabel: string;
  sets: { diff: OverlayChunkSet; context: OverlayChunkSet; manifest: OverlayChunkSet };
  deps?: PersistDeps;
}): Promise<void>; // failure mid-way: remove already-saved sets, throw ReviewPackError("store_write_failed")

// digest.ts
export function renderDigest(pack: ReviewPack): string; // final `redact()` gate inside

// pack.ts
export type BuildReviewPackInput = {
  repoRoot: string;         // any dir inside the repo; resolved to top-level
  storeRoot: string;
  range?: string | undefined;
  // durable receipts key (spec Open Question 2): CLI injects a registry
  // rootPath match, MCP injects () => its projectId input; default
  // () => undefined → overlay receipts only.
  resolveProjectId?: (repoTopLevel: string) => string | undefined;
  execGit?: ExecGit;
  now?: () => string;       // ISO; default new Date().toISOString()
  newId?: () => string;     // pack id entropy; default randomUUID-based
};
export type ReviewPack = {
  packId: string;           // "rp-" + 12 hex
  workspaceKey: string;
  range: RangeInfo;
  claims: ClaimsManifest;
  files: Array<{ path: string; status: ChangedFile["status"]; diffChunkIds: string[]; contextChunkIds: string[] }>;
  chunkSets: { diff: string; context: string; manifest: string };
  digest: string;
};
export async function buildReviewPack(input: BuildReviewPackInput): Promise<ReviewPack>;
```
Chunk-set assembly: overlay schema fields per packages/content-store/src/chunk-set.ts:41-55 (`chunkSetId`, `liveSessionId`, `workspaceKey`, `createdAt`, `source`, `rawBytes`, `redacted: true`, `chunks[{ id, startLine, endLine, bytes, text }]`). `diff` set = redacted unified diff split on `/^diff --git /m` boundaries, one chunk per file segment, segments over 400 lines sub-split with `chunkByLines(segment, 80)`; chunk ids `"0".."n"` (the existing numeric convention the expand CLI shows). `context` set = one chunk per `ContextExtent` (real file line numbers). `manifest` set = one chunk holding `JSON.stringify(claims, null, 2)`. Digest sections: header (`review pack <packId>  <base>..<head>`), claims-vs-receipts table (a `ReceiptRow` without `exitCode` renders the literal cell "receipt without exit code" — the graceful-degradation contract for pre-C3 rows), per-file chunk pointers, expand hint (`mega output chunk "<chunkSetId>" "<i>"` — the exact recovery-footer phrasing users already see). `empty_diff` thrown before any persist when `listChangedFiles` is empty.

**Steps:**

- [ ] Write failing `test/pack.test.ts` (fixture repo from Task 2's `initFixtureRepo` helper — extract it to `test/fixture.ts` and import in both tests):
```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOverlayChunkSet } from "@megasaver/content-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewPackError } from "../src/errors.js";
import { buildReviewPack } from "../src/pack.js";
import { git, initFixtureRepo } from "./fixture.js";

describe("buildReviewPack", () => {
  let repo: string;
  let store: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-rp-pack-"));
    store = mkdtempSync(join(tmpdir(), "megasaver-rp-store-"));
    initFixtureRepo(repo);
    git(repo, "checkout", "-b", "feat/x");
    writeFileSync(join(repo, "alpha.ts"), "export function alpha(): number {\n  return 42;\n}\n");
    git(repo, "add", "alpha.ts");
    git(repo, "commit", "-m", "fix(core): alpha returns 42");
  });
  afterEach(() => {
    for (const d of [repo, store]) rmSync(d, { recursive: true, force: true });
  });

  it("persists three expandable chunk sets and returns their ids", async () => {
    const pack = await buildReviewPack({ repoRoot: repo, storeRoot: store, range: "main..HEAD" });
    expect(pack.claims.claims[0]?.subject).toBe("fix(core): alpha returns 42");
    const diffSet = await loadOverlayChunkSet({
      storeRoot: store,
      workspaceKey: pack.workspaceKey,
      liveSessionId: `review-${pack.packId}`,
      chunkSetId: pack.chunkSets.diff,
    });
    expect(diffSet.redacted).toBe(true);
    expect(diffSet.chunks.some((c) => c.text.includes("return 42"))).toBe(true);
    expect(pack.digest).toContain("mega output chunk");
  });

  it("redacts secrets out of the digest and the stored diff", async () => {
    writeFileSync(join(repo, "leak.ts"), 'export const K = "AKIAIOSFODNN7EXAMPLE";\n');
    git(repo, "add", "leak.ts");
    git(repo, "commit", "-m", "chore: add config");
    const pack = await buildReviewPack({ repoRoot: repo, storeRoot: store, range: "main..HEAD" });
    expect(pack.digest).not.toContain("AKIAIOSFODNN7EXAMPLE");
    const diffSet = await loadOverlayChunkSet({
      storeRoot: store,
      workspaceKey: pack.workspaceKey,
      liveSessionId: `review-${pack.packId}`,
      chunkSetId: pack.chunkSets.diff,
    });
    expect(diffSet.chunks.every((c) => !c.text.includes("AKIAIOSFODNN7EXAMPLE"))).toBe(true);
  });

  it("fails closed on a dirty tree with nothing persisted", async () => {
    writeFileSync(join(repo, "alpha.ts"), "// dirty\n");
    await expect(
      buildReviewPack({ repoRoot: repo, storeRoot: store, range: "main..HEAD" }),
    ).rejects.toThrow(ReviewPackError);
    const { readdirSync, existsSync } = await import("node:fs");
    const contentRoot = join(store, "content");
    expect(!existsSync(contentRoot) || readdirSync(contentRoot).length === 0).toBe(true);
  });

  it("throws empty_diff for an empty range", async () => {
    await expect(
      buildReviewPack({ repoRoot: repo, storeRoot: store, range: "HEAD..HEAD" }),
    ).rejects.toMatchObject({ code: "empty_diff" });
  });

  it("removes earlier sets when a later save fails (no partial pack)", async () => {
    // deps-injected persistPack unit test lives beside this: drive persistPack
    // directly with a `save` that succeeds once then throws, assert `remove`
    // was called with the first set's key and the error code is store_write_failed.
    const { persistPack } = await import("../src/persist.js");
    const saved: string[] = [];
    const removed: string[] = [];
    const failingDeps = {
      save: async ({ chunkSet }: { storeRoot: string; chunkSet: { chunkSetId: string } }) => {
        if (saved.length === 1) throw new Error("disk full");
        saved.push(chunkSet.chunkSetId);
      },
      remove: async ({ chunkSetId }: { chunkSetId: string }) => {
        removed.push(chunkSetId);
      },
    };
    await expect(
      persistPack({
        storeRoot: store,
        workspaceKey: "0123456789abcdef",
        liveSessionId: "review-rp-000000000000",
        createdAt: "2026-08-06T12:00:00.000Z",
        rangeLabel: "main..HEAD",
        sets: fakeSets(),
        deps: failingDeps as never,
      }),
    ).rejects.toMatchObject({ code: "store_write_failed" });
    expect(removed).toEqual(saved);
  });
});

// Three minimal schema-valid OverlayChunkSets (packages/content-store/src/chunk-set.ts:41-55).
function fakeSets() {
  const make = (suffix: "diff" | "context" | "manifest") => ({
    chunkSetId: `rp-000000000000-${suffix}`,
    liveSessionId: "review-rp-000000000000",
    workspaceKey: "0123456789abcdef",
    createdAt: "2026-08-06T12:00:00.000Z",
    source: { kind: "command" as const, command: "mega", args: ["review", "pack", "main..HEAD"] },
    rawBytes: 1,
    redacted: true,
    chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 1, text: "x" }],
  });
  return { diff: make("diff"), context: make("context"), manifest: make("manifest") };
}
```
- [ ] Run `pnpm --filter @megasaver/review-pack test -- pack` — expect FAIL: modules missing.
- [ ] Implement `persist.ts`, `digest.ts`, `pack.ts`. Orchestration order in `buildReviewPack`: `repoTopLevel` (null → `git_unavailable`) → `assertCleanTree` → `resolveRange` → `listChangedFiles` (empty → `empty_diff`) → `listCommits` + `unifiedDiff` + per-file `changedLineRanges`/`fileAtHead` → `semanticDiffChunks` + `enclosingExtents` → `receiptCandidatesFromEvents(readReceiptEvents({ root: storeRoot }, { workspaceKey, ...(projectId !== undefined ? { projectId } : {}) }), { now: now() })` with `projectId = resolveProjectId?.(topLevel)` → `buildClaimsManifest` → `redact()` diff text, every extent text, and manifest JSON (packages/policy/src/redact.ts:44) → assemble three `OverlayChunkSet`s → `persistPack` → `renderDigest` (ends with `redact(digestText).redacted`). `packId = "rp-" + newId-derived 12 lowercase hex`; `workspaceKey = encodeWorkspaceKey(topLevel)`.
- [ ] Run `pnpm --filter @megasaver/review-pack test` — expect PASS (all suites incl. guards).
- [ ] Commit: `feat(review-pack): persist pack and digest`

---

### Task 7: CLI `mega review pack`

**Files:**
- `apps/cli/src/commands/review/pack.ts`, `apps/cli/src/commands/review/index.ts` (new)
- `apps/cli/src/main.ts` (register `review` in `subCommands`, main.ts:60)
- `apps/cli/package.json` (add `@megasaver/review-pack` workspace dep)
- `apps/cli/test/review-pack.test.ts` (new)

**Interfaces (per wiki/workflows/cli-test-pattern.md — inner run fn + thin Citty adapter):**
```ts
export type RunReviewPackInput = {
  range: string | undefined;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  execGit?: ExecGit;
  now?: () => string;
  newId?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export async function runReviewPack(input: RunReviewPackInput): Promise<0 | 1>;
export const reviewPackCommand: ReturnType<typeof defineCommand>;
export const reviewCommand: ReturnType<typeof defineCommand>; // subCommands: { pack: reviewPackCommand }
```
Store resolution: `resolveStorePath` + `readStoreEnv` exactly as apps/cli/src/commands/output/chunk.ts:31-45 (real precedent). Durable-receipt project resolution: `const { registry } = await ensureStoreReady(rootDir)` (apps/cli/src/store.ts:79, the output/exec.ts:99 precedent), then pass `resolveProjectId: (top) => registry.listProjects().find((p) => p.rootPath === top)?.id` (`listProjects` on the registry interface, packages/core/src/registry.ts:71) — reads stats rows only through review-pack, preserving the CLI-never-imports-stats invariant (core/src/index.ts:254-255). No match → overlay-only receipts (spec Open Question 2). Error mapping: `ReviewPackError` → stderr `error: <message>` + exit 1; `--json` failure → `JSON.stringify({ ok: false, reason: err.code })`.

**Steps:**

- [ ] Write failing `apps/cli/test/review-pack.test.ts` — direct inner-fn invocation (no Citty ceremony needed for logic tests, per the wiki pattern's "When NOT to use env-var injection"), fixture repo inline:
```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runReviewPack } from "../src/commands/review/pack.js";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(tmpdir(), "megasaver-no-gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });

describe("mega review pack", () => {
  let repo: string;
  let store: string;
  let out: string[];
  let err: string[];
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-review-repo-"));
    store = mkdtempSync(join(tmpdir(), "megasaver-review-store-"));
    out = [];
    err = [];
    git(repo, "init");
    git(repo, "checkout", "-b", "main");
    git(repo, "config", "user.email", "test@megasaver.dev");
    git(repo, "config", "user.name", "Test");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, "add", "a.ts");
    git(repo, "commit", "-m", "feat: seed");
    git(repo, "checkout", "-b", "feat/y");
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    git(repo, "add", "a.ts");
    git(repo, "commit", "-m", "fix: bump a");
  });
  afterEach(() => {
    for (const d of [repo, store]) rmSync(d, { recursive: true, force: true });
  });

  const base = () => ({
    range: "main..HEAD",
    json: false,
    storeFlag: store,
    cwd: repo,
    home: "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
  });

  it("prints a digest with claims and expand pointers, exit 0", async () => {
    expect(await runReviewPack(base())).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("fix: bump a");
    expect(text).toContain("mega output chunk");
  });

  it("--json emits the pack with three chunk-set ids", async () => {
    expect(await runReviewPack({ ...base(), json: true })).toBe(0);
    const pack = JSON.parse(out.join("\n"));
    expect(Object.keys(pack.chunkSets).sort()).toEqual(["context", "diff", "manifest"]);
  });

  it("dirty tree exits 1 with a clear error and no output pack", async () => {
    writeFileSync(join(repo, "a.ts"), "// dirty\n");
    expect(await runReviewPack(base())).toBe(1);
    expect(err.join("\n")).toContain("dirty");
    expect(out).toEqual([]);
  });
});
```
- [ ] Run `pnpm --filter @megasaver/cli test -- review-pack` — expect FAIL: module missing.
- [ ] Implement `pack.ts` (inner fn: resolve store per the chunk.ts precedent, get `registry` via `ensureStoreReady`, call `buildReviewPack({ repoRoot: input.cwd, storeRoot, range: input.range, resolveProjectId, ...injected })`, print digest or JSON), `index.ts` (`defineCommand` with `subCommands: { pack: reviewPackCommand }`), register `review: reviewCommand` in `apps/cli/src/main.ts` subCommands (alphabetical slot), add the workspace dep, `pnpm install`.
- [ ] Run `pnpm --filter @megasaver/cli test -- review-pack` — PASS; smoke by hand once: `pnpm --filter @megasaver/cli build` (evidence capture happens in Task 9).
- [ ] Commit: `feat(cli): add mega review pack command`

---

### Task 8: MCP tool `review_pack`

**Files:**
- `packages/mcp-bridge/src/tool-name.ts` (add `"review_pack"` alphabetically, between `"record_task_step"` and `"retry_failed_step"`, tool-name.ts:15-51)
- `packages/mcp-bridge/src/tool-schemas.ts` (entry in `TOOL_INPUT_SCHEMAS` — the `Record<McpToolName, z.ZodTypeAny>` at tool-schemas.ts:45 fails typecheck until added: that IS the red step)
- `packages/mcp-bridge/src/server.ts` (TOOL_DEFS entry at server.ts:136; dispatch case; `recordChunkSetIds` helper beside `recordChunkSetId`, server.ts:288-291)
- `packages/mcp-bridge/src/tools/review-pack.ts` (new)
- `packages/mcp-bridge/package.json` (add `@megasaver/review-pack` dep)
- `packages/mcp-bridge/test/review-pack.test.ts` (new)

**Interfaces:**
```ts
// tools/review-pack.ts — mirrors tools/get-edit-impact.ts env/handler shape
export type ReviewPackToolEnv = { registry: CoreRegistry; storeRoot: string };
export const reviewPackInputSchema: z.ZodType<{ projectId: string; range?: string }>; // .strict()
export type ReviewPackToolResult = ReviewPack; // from @megasaver/review-pack
export async function handleReviewPack(env: ReviewPackToolEnv, rawArgs: unknown): Promise<ReviewPackToolResult>;

// server.ts addition
const recordChunkSetIds = (ids: readonly string[]): void => {
  for (const id of ids) returnedChunkSetIds.add(id);
};
```
Handler: parse args (`McpBridgeError("validation_failed", ...)` on failure, the fetch-chunk.ts:36-40 idiom), resolve the project by `projectId` through `env.registry` to its `rootPath` (the get-edit-impact precedent), call `buildReviewPack({ repoRoot: rootPath, storeRoot: env.storeRoot, range, resolveProjectId: () => args.projectId })` (durable receipts ride the tool's own `projectId` input), map `ReviewPackError` → `McpBridgeError`. Dispatch case calls `recordChunkSetIds([r.chunkSets.diff, r.chunkSets.context, r.chunkSets.manifest])` so `mega_fetch_chunk`'s expansion guard (server.ts:281-291) admits them. TOOL_DEFS description: "Build an evidence-preserving review pack for a commit range: semantic diff chunks, enclosing-declaration context, test receipts, claims manifest; expandable via mega_fetch_chunk."

**Steps:**

- [ ] Add `"review_pack"` to `mcpToolNameSchema` and run `pnpm --filter @megasaver/mcp-bridge typecheck` — expect FAIL: `TOOL_INPUT_SCHEMAS` (tool-schemas.ts:45, a literal record) is no longer exhaustive (this is the designed red state; cite tool-schemas.ts:39-41 "Record<McpToolName, ...> is load-bearing"). `PUBLISHED_INPUT_SCHEMAS` (server.ts:124) is auto-derived from it via `Object.fromEntries` + an `as Record<McpToolName, object>` cast — it produces no compile error and has no manual entry to add.
- [ ] Write failing `packages/mcp-bridge/test/review-pack.test.ts` (mirror the fixture-repo setup from Task 7's test; registry stub with a project whose `rootPath` is the fixture repo — copy the registry stub shape from an existing tool test such as `packages/mcp-bridge/test/check-approach.test.ts`, real file):
```ts
import { describe, expect, it } from "vitest";
import { handleReviewPack } from "../src/tools/review-pack.js";

describe("review_pack tool", () => {
  it("rejects malformed args", async () => {
    await expect(
      handleReviewPack({ registry: stubRegistry(), storeRoot: "/tmp/none" } as never, { nope: 1 }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("builds a pack for a registered project and returns three chunk-set ids", async () => {
    const { registry, repo, store } = await fixtureProject(); // helper in this file: temp repo + stub registry
    const result = await handleReviewPack({ registry, storeRoot: store }, {
      projectId: PROJECT_ID,
      range: "main..HEAD",
    });
    expect(Object.keys(result.chunkSets).sort()).toEqual(["context", "diff", "manifest"]);
    expect(result.digest).not.toContain("AKIA"); // redaction belt
  });
});
```
- [ ] Implement `tools/review-pack.ts`, the `TOOL_INPUT_SCHEMAS` entry (`PUBLISHED_INPUT_SCHEMAS` at server.ts:124 auto-derives — no edit), the `TOOL_DEFS` entry, and the dispatch `case "review_pack":` with `recordChunkSetIds`. Naming (spec Open Question 3, resolved): `exposedToolName("review_pack", mode)` is identity in both modes — the three-entry `NAME_PAIRS` map is the only rename source (tool-naming.ts:37-40); no identity row exists or is needed.
- [ ] Run `pnpm --filter @megasaver/mcp-bridge test` + `typecheck` — expect PASS (including `tool-name-forge.test.ts` and `server.e2e.test.ts`, which enumerate the tool list).
- [ ] Commit: `feat(mcp-bridge): add review_pack tool`

---

### Task 9: verification evidence, changeset, wiki

**Files:**
- `.changeset/review-packs.md` (new)
- `wiki/entities/review-pack.md` (new), `wiki/index.md`, `wiki/log.md` (edit)

**Steps:**

- [ ] Run `pnpm verify` at repo root — lint + typecheck + full vitest must be green before any "done" claim (§9.4).
- [ ] Capture CLI smoke evidence (§9.5) in the PR body: a terminal session on a real feature branch of this repo showing `mega review pack main..HEAD` digest, then `mega output chunk "<returned diff set id>" "0"` round-tripping a chunk, then `mega review pack` on a dirtied tree failing closed with exit 1.
- [ ] Add `.changeset/review-packs.md`: minor for `@megasaver/output-filter`, `@megasaver/cli`, `@megasaver/mcp-bridge`; new package `@megasaver/review-pack` at 0.1.0 (no `@megasaver/stats` or `@megasaver/context-gate` entries — this pair does not touch them; C3 owns those seams).
- [ ] Write `wiki/entities/review-pack.md` (page format per wiki/CLAUDE.md), link it from `wiki/index.md` Entities, append a timestamped `wiki/log.md` entry.
- [ ] Request `code-reviewer` pass, then `critic` pass (separate fresh contexts, author ≠ reviewer), then `verifier` with the smoke evidence (§9.6-7).
- [ ] Commit: `docs(wiki): record review-pack entity page` (changeset rides the last feature commit or its own `chore(changeset)` commit — keep one logical change per commit).

---

## Self-review notes

- Coverage: spec components 1-4 map to Task 4 (receipts view), Tasks 1-6 (builder), 7 (CLI), 8 (MCP), 9 (DoD). All five error codes exercised: `dirty_worktree`/`git_unavailable`/`bad_range` (Task 2), `empty_diff`/`store_write_failed` (Task 6). Receipt persistence is deliberately absent: claim-verification-gate (build-order 3) owns `childExitCode` and the run-command seam writes; this plan only consumes.
- Placeholder scan: every referenced symbol is either defined in a task (`ReceiptCandidate`, `readReceiptEvents`, `receiptCandidatesFromEvents`, `ReviewPackError`, `semanticDiffChunks`, `enclosingExtents`, `buildClaimsManifest`, `persistPack`, `buildReviewPack`, `runReviewPack`, `handleReviewPack`, `recordChunkSetIds`) or cited to a real path:line (`chunkBySemantic` semantic.ts:124, `saveOverlayChunkSet` store.ts:169, `overlayChunkSetSchema` chunk-set.ts:41, `encodeWorkspaceKey` workspace-key.ts:20, `redact` redact.ts:44, `fetchChunk` fetch-chunk.ts:131, `returnedChunkSetIds` server.ts:287, `StatsStore = { root: string }` store.ts:23, `readEvents`/`readOverlayEvents` store.ts:156/694, C3 event seams run-command.ts:433/679 with `result.chunkSetId` at 402/668, event `label` from `redactedLabel` run-command.ts:292/580, `exposedToolName` identity default tool-naming.ts:37-40, `PUBLISHED_INPUT_SCHEMAS` derived server.ts:124, `listProjects` registry.ts:71, `ensureStoreReady` apps/cli/src/store.ts:79, `defaultExecGit` git-delta.ts:7).
- ASSUMPTION markers carried from the spec: overlay workspaceKey matches `encodeWorkspaceKey(repoTopLevel)` and durable rows need a registry rootPath match (spec Open Question 2), stats events-file layout coupling in the enumerator (spec Open Question 4), overlay retention applies to packs (no hold in v1). Resolved, no longer assumptions: `StatsStore` is `{ root: string }` (store.ts:23, verified); `review_pack` naming-mode identity (tool-naming.ts:37-40, spec Open Question 3 resolved). Blocked-by: C3's `childExitCode` schema field must land before Task 4's exit-code path compiles.
- No timing-tight tests: all determinism via fixture repos, injected `now`/`newId`/`execGit`/`deps`, and count/structure assertions.
