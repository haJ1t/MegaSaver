# Workspace Preflight Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** `mega preflight snapshot` captures a git-grounded world manifest as a reserved content sibling; `mega preflight diff` renders a deterministic, bounded diff between two snapshots. Content-store owns the file contract; CLI owns git capture + renderer.

**Architecture:** Pure builder/comparator (`preflight/snapshot.ts`) + bounded git capturer (`preflight/git-capture.ts`) + two citty commands. No hooks, no daemon, no network.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, node:child_process execFile, node:fs, `@megasaver/content-store`, `@megasaver/shared`, `@megasaver/policy`.

## Global Constraints

- `PREFLIGHT_FILENAME_RE = /^preflight-\d+-[a-z0-9]{6}\.json$/` — only this matches; all other `*.json` in the session dir are chunk sets.
- Store skips: `listChunkSets` / `listOverlayChunkSets` / `pruneOlderThan` ignore every preflight file (mirror of `CAPSULE_FILENAME` handling in `docs/superpowers/plans/2026-08-06-compaction-guard.md` Task 1).
- Git commands are `execFile` argv arrays with 2000ms timeout; never `exec` shell strings; `git -C <root>` confines.
- Snapshot arrays are lexicographically sorted; diff output is sorted; identical snapshots → empty diff exit 0.
- Redaction: untracked paths via `redact()` once; no file contents read.
- Caps: diff renderer ≤ 200 paths per section + "+N more".
- Conventional commits ≤ 50 chars, English only.

---

### Task 1: content-store — preflight filename + listing contract

**Files:**
- Modify: `packages/content-store/src/store.ts`
- Modify: `packages/content-store/src/index.ts`
- Test: `packages/content-store/test/preflight-list.test.ts`

**Interfaces:**
```ts
// packages/content-store/src/store.ts
export const PREFLIGHT_FILENAME_RE: RegExp;
export function isPreflightFilename(name: string): boolean;
export async function listPreflightSnapshots(input: {
  storeRoot: string; workspaceKey?: string; liveSessionId?: string; projectId?: string; sessionId?: string;
}): Promise<readonly { snapshotId: string; path: string; createdAt: string }[]>;
export function readPreflightSnapshot(path: string): unknown | null; // Zod strict, null on malformed
export const preflightSnapshotSchema: z.ZodType;
```

- [ ] Write failing test `packages/content-store/test/preflight-list.test.ts`:
```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PREFLIGHT_FILENAME_RE, isPreflightFilename, listOverlayChunkSets, saveOverlayChunkSet } from "../src/index.js";
let root: string;
beforeEach(()=>{ root = mkdtempSync(join(tmpdir(),"preflight-")); });
afterEach(()=>{ rmSync(root,{recursive:true,force:true}); });
describe("preflight skip",()=>{
  it("matches only preflight names",()=>{
    expect(isPreflightFilename("preflight-1234567890-abc123.json")).toBe(true);
    expect(isPreflightFilename("cs-abc.json")).toBe(false);
    expect(PREFLIGHT_FILENAME_RE.test("preflight-1-a1b2c3.json")).toBe(true);
  });
  it("overlay listing skips preflight siblings",async()=>{
    await saveOverlayChunkSet({storeRoot: root, chunkSet: {chunkSetId:"cs-1", liveSessionId:"s1", workspaceKey:"wk1", createdAt:"2026-08-11T00:00:00.000Z", source:{kind:"file",path:"a.ts"}, rawBytes:1, redacted:true, chunks:[{id:"c0",startLine:0,endLine:1,bytes:1,text:"x"}]} as never});
    mkdirSync(join(root,"content","wk1","s1"),{recursive:true});
    writeFileSync(join(root,"content","wk1","s1","preflight-123456-abc123.json"),`{"version":1}\n`);
    const sets = await listOverlayChunkSets({storeRoot: root, workspaceKey:"wk1", liveSessionId:"s1"});
    expect(sets.map(s=>s.chunkSetId)).toEqual(["cs-1"]);
  });
});
```
- [ ] Run `pnpm --filter @megasaver/content-store exec vitest run test/preflight-list.test.ts` — FAIL
- [ ] Implement in `store.ts`: regex, `isPreflightFilename`, skip in `listChunkSets`/`listOverlayChunkSets`/`pruneOlderThan` (third skip beside `CAPSULE_FILENAME`), `listPreflightSnapshots` (readdir + filter by regex, stat + read, return sorted newest-first), `preflightSnapshotSchema` (strict, version literal 1, sha256-ish fields).
- [ ] Export from `index.ts`
- [ ] Run test — PASS, plus `pnpm --filter @megasaver/content-store test` green
- [ ] Commit: `feat(content-store): preflight snapshot sibling contract`

---

### Task 2: pure snapshot builder + comparator + renderer

**Files:**
- Create: `apps/cli/src/preflight/snapshot.ts`
- Test: `apps/cli/test/preflight/snapshot.test.ts`

**Interfaces:**
```ts
export const PREFLIGHT_VERSION = 1;
export type PreflightSnapshot = z.infer<typeof preflightSnapshotSchema>;
export function buildPreflightSnapshot(input: { git: GitState; workspaceKey: string; sessionId: string; now: ()=>number; label?: string; }): PreflightSnapshot;
export function comparePreflightSnapshots(a: PreflightSnapshot, b: PreflightSnapshot): PreflightDiff;
export function renderPreflightDiff(diff: PreflightDiff, opts?: { maxPerSection?: number }): string;
export function parsePreflightId(filename: string): string | null;
```

- [ ] Write failing test `apps/cli/test/preflight/snapshot.test.ts` — cases: sorting (shuffle in → sorted out), compare identical → empty, renderer trims 300 untracked → first 200 + "+100 more", `parsePreflightId` extracts id, schema rejects extra key.
- [ ] Run — FAIL
- [ ] Implement `snapshot.ts` (pure, ≤ 300 LOC; sort arrays, counters, bounded renderer)
- [ ] Run — PASS
- [ ] Commit: `feat(cli): preflight snapshot model + renderer`

---

### Task 3: git capture (bounded execFile)

**Files:**
- Create: `apps/cli/src/preflight/git-capture.ts`
- Test: `apps/cli/test/preflight/git-capture.test.ts`

**Interfaces:**
```ts
export type GitState = { available: boolean; headOid: string | null; branch: string | null; staged:{path:string;status:string;hash:string}[]; unstaged:{path:string;status:string;hash:string}[]; untracked:string[]; reason?: string };
export function captureGitState(gitRoot: string, opts?: { timeoutMs?: number }): Promise<GitState>;
export function parsePorcelainZ(stdout: Buffer): { staged: GitState["staged"]; unstaged: GitState["unstaged"]; untracked: string[] };
```

- [ ] Write failing test: `parsePorcelainZ` with crafted `Buffer.from(" M foo.ts\0A  bar.ts\0?? baz.ts\0","utf8")` → staged/unstaged/untracked split; `captureGitState` on a real tmp repo (`git init`, `git commit`) returns headOid length 40; missing dir → available false.
- [ ] Run — FAIL
- [ ] Implement: `execFile("git",["-C",gitRoot,"rev-parse","HEAD"],{timeout:2000})` etc., parse `-z`; catch timeout → `{available:false, reason:"timeout"}`.
- [ ] Run — PASS
- [ ] Commit: `feat(cli): git preflight capture`

---

### Task 4: `mega preflight` commands

**Files:**
- Create: `apps/cli/src/commands/preflight/snapshot.ts`
- Create: `apps/cli/src/commands/preflight/diff.ts`
- Create: `apps/cli/src/commands/preflight/index.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/commands/preflight.test.ts`

**Interfaces:**
```ts
export type RunPreflightSnapshotInput = { cwd:string; home:string; storeFlag?:string; label?:string; now:()=>number; stdout:(s:string)=>void; stderr:(s:string)=>void; platform: NodeJS.Platform };
export function runPreflightSnapshot(input: RunPreflightSnapshotInput): Promise<0|1>;
export type RunPreflightDiffInput = { cwd:string; home:string; storeFlag?:string; a?:string; b?:string; last?:boolean; json?:boolean; stdout:(s:string)=>void; stderr:(s:string)=>void };
export function runPreflightDiff(input: RunPreflightDiffInput): Promise<0|1>;
```

- [ ] Write failing tests (seed tmp store + `registry.createProject` + `ensureStoreReady`; init tmp git repo under `cwd`): snapshot writes file visible via `listPreflightSnapshots`; second snapshot after `writeFile(cwd+"/new.ts")` → diff shows `untracked: new.ts`; `--json` parses; no project → exit 1.
- [ ] Run — FAIL
- [ ] Implement commands (io-injected, `resolveStorePath`/`ensureStoreReady`/`findProjectByCwd`/`encodeWorkspaceKey`/`SAFE_SEGMENT` gated, `atomicWriteFile` with 0600, snapshotId generation).
- [ ] Register in `main.ts` as `preflight: { snapshot, diff }`
- [ ] Run tests + `pnpm --filter @megasaver/cli test -- test/dependency-graph.test.ts` — PASS
- [ ] Commit: `feat(cli): mega preflight snapshot + diff`

---

### Task 5: changeset, wiki, verify

**Files:** `.changeset/workspace-preflight-diff.md`, `wiki/entities/cli.md`, `wiki/index.md`, `wiki/log.md`

- [ ] Add changeset (`@megasaver/content-store` minor, `@megasaver/cli` minor)
- [ ] Update wiki (new `mega preflight` section, quick-links, log entry)
- [ ] Run `pnpm verify` — lint+typecheck+test green; capture tail
- [ ] Smoke: tmp dir `mega project create` → `mega preflight snapshot` → `touch foo.ts` → `mega preflight snapshot` → `mega preflight diff --last` shows foo.ts
- [ ] Commit: `chore: changeset + wiki for preflight`
- [ ] Hand off to `code-reviewer` fresh context

---

## Self-review checklist

- [ ] preflight files are skipped by all chunk-set listers + pruner
- [ ] git argv array, timeout, fail-open on no-git
- [ ] atomic write 0600, sorted arrays, bounded renderer
- [ ] no cross-workspace diff, no patch bodies, no contents read
