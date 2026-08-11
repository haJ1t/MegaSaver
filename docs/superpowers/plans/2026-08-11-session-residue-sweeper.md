# Session Residue Sweeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** `mega sweep scan` ranks residue deterministically; `mega sweep quarantine` moves files into `.megasaver/quarantine/<ts>-<id>/` with a manifest + undo.sh (never deletes); `mega sweep restore` moves them back collision-safe.

**Architecture:** Pure ranking (`sweep/rank.ts`) + file-move layer (`sweep/quarantine.ts`) + three citty commands. No hooks in v1, no LLM, no network.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, node:fs, `@megasaver/policy`, `@megasaver/content-store` (read-only), `@megasaver/shared`.

## Global Constraints

- Never deletes: `renameSync` preferred, `copyFileSync`+`unlinkSync` fallback on EXDEV; no `rmSync` on user files.
- No `--force` overwrite on restore; collision → skip + warn.
- Path validation: `SAFE_REL_PATH` + normalize + !isAbsolute + !startsWith("..") before every move.
- Fenced/secret paths are refused (skip + warning), never swept.
- Quarantine dir 0700, manifest 0600, deterministic bucket order `tmp > cache > build-output > agent-draft > other`.
- Conventional commits ≤ 50 chars.

---

### Task 1: pure ranking + guards

**Files:** `apps/cli/src/sweep/rank.ts` (new), `apps/cli/test/sweep/rank.test.ts` (new)

**Interfaces:**
```ts
export const RESIDUE_BUCKETS = ["tmp","cache","build-output","agent-draft","other"] as const;
export type ResidueBucket = typeof RESIDUE_BUCKETS[number];
export type RankedEntry = { relPath: string; bucket: ResidueBucket; size: number; mtimeMs: number };
export function rankResidue(entries: { relPath:string; size:number; mtimeMs:number }[], ctx:{ sessionWindowMs?: number }): RankedEntry[];
export function isFencedRelPath(relPath:string): boolean;
export function isQuarantineRelPath(relPath:string): boolean;
export const SAFE_REL_PATH: RegExp;
```

- [ ] Write failing test: `a.tmp→tmp`, `dist/foo.js→build-output`, `node_modules/.cache/x→cache`, quarantine itself → filtered, fenced `generated/keep.js` → excluded via mocked fence set.
- [ ] Run — FAIL
- [ ] Implement `rank.ts` (suffix checks, fence reuse from `@megasaver/policy`, quarantine prefix guard, sort by bucket rank then path)
- [ ] Run — PASS
- [ ] Commit: `feat(cli): residue ranking + guards`

---

### Task 2: quarantine file moves + manifest + index

**Files:** `apps/cli/src/sweep/quarantine.ts` (new), `apps/cli/test/sweep/quarantine.test.ts` (new)

**Interfaces:**
```ts
export type QuarantineEntry = { from:string; to:string; size:number; mtimeMs:number; hash:string; move:"rename"|"copy" };
export type QuarantineManifest = { version:1; id:string; createdAt:string; snapshotId:string|null; entries: QuarantineEntry[]; undoSh:string };
export function buildQuarantineId(now:()=>number): string; // <epoch>-<6id>
export function quarantineFiles(input:{ repoRoot:string; entries: RankedEntry[]; snapshotId:string|null; now:()=>number }): QuarantineManifest;
export function restoreQuarantine(input:{ repoRoot:string; manifest: QuarantineManifest }): { moved:number; skipped:{path:string;reason:string}[] };
export function readQuarantineManifest(repoRoot:string, id:string): QuarantineManifest | null;
export function writeQuarantineIndex(storeRoot:string, workspaceKey:string, manifest: QuarantineManifest): void;
```

- [ ] Write failing test: create tmp repo with `a.tmp` + `b.ts`; `quarantineFiles` moves `a.tmp` byte-identically (sha256 same), `restoreQuarantine` moves back; collision (pre-create target) → skipped; unsafe `../evil` → throws; EXDEV fallback mocked via `renameSync` throwing `code:EXDEV` → copy path taken.
- [ ] Run — FAIL
- [ ] Implement: validate each `relPath`, `mkdir -p` quarantine subdir, `renameSync` try/catch EXDEV → copy+unlink, hash via `createHash("sha256")`, manifest Zod strict, index atomic write.
- [ ] Run — PASS
- [ ] Commit: `feat(cli): quarantine move + restore`

---

### Task 3: `mega sweep` commands

**Files:** `apps/cli/src/commands/sweep/scan.ts`, `quarantine.ts`, `restore.ts`, `index.ts` (new), `apps/cli/test/commands/sweep.test.ts` (new), `apps/cli/src/main.ts` (register)

- [ ] Write failing tests: scan finds `a.tmp` (tmp bucket) and excludes `generated/keep.js`; quarantine --dry-run prints plan without moving; quarantine moves and writes manifest; restore --last moves back; fenced file skipped with warning.
- [ ] Run — FAIL
- [ ] Implement io-injected `runSweepScan`/`runSweepQuarantine`/`runSweepRestore`; wire `findProjectByCwd`, `resolveStorePath`, `captureGitState` or `listPreflightSnapshots` join, `rankResidue`, `redact` on output, citty args.
- [ ] Run + `pnpm --filter @megasaver/cli test -- test/dependency-graph.test.ts` — PASS
- [ ] Commit: `feat(cli): mega sweep scan/quarantine/restore`

---

### Task 4: changeset, wiki, verify

- [ ] Changeset `@megasaver/cli` minor (HIGH risk)
- [ ] Wiki: `wiki/entities/cli.md` sweep section, `wiki/log.md` entry
- [ ] `pnpm verify` green; smoke: `mega sweep scan` → `mega sweep quarantine --dry-run` → quarantine → restore
- [ ] Commit: `chore: changeset + wiki for sweeper`
- [ ] Hand off to `code-reviewer` AND `critic` + `security-reviewer` (path traversal)
