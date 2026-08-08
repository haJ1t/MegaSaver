# Test-Bite Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `mega prove bite [<base>..<head>]` per the approved spec
`docs/superpowers/specs/2026-08-06-test-bite-proof-design.md`: in a disposable
git worktree, apply only the diff's test hunks and run the named test expecting
RED, then bring the tree to the full-diff state expecting GREEN; capture both
runs as receipts (exit union + parser-extracted first failure + overlay
chunk-set triple) and write a `BITES` / `DOES_NOT_BITE` / `CANNOT_SPLIT` /
`INFRA_FAIL` attestation keyed by the sha256 of the full diff.

**Architecture:** Six new modules under `packages/context-gate/src/prove/`
(`diff-split.ts`, `frameworks.ts`, `worktree.ts`, `run-phase.ts`, `attest.ts`,
`orchestrate.ts`) plus a Citty `prove bite` command in `apps/cli`. Reuses
shipped seams only — `runChild` (`packages/context-gate/src/run-command.ts:119`)
and `RunCommandSpawn` (`run-command.ts:62`), `recoverableChunks`
(`packages/context-gate/src/recoverable-chunks.ts:21`, internal — imported
relatively, it is not on the package's public entry), `filterOutput`
(`packages/output-filter/src/types.ts:208`), `saveOverlayChunkSet`
(`packages/content-store/src/store.ts:169`), `atomicWriteFile`
(`packages/content-store/src/atomic-write.ts:21`), `assertSafeSegment`
(`packages/content-store/src/paths.ts:5`), `compileGlob`
(`packages/policy/src/secret-paths.ts:63`), `redact`
(`packages/policy/src/redact.ts:44`), `evaluateCommand`
(`packages/policy/src/evaluate-command.ts:23`), `encodeWorkspaceKey`
(`packages/shared/src/workspace-key.ts:20`). No new packages, no new external
dependencies (workspace protocol only; the repo has no pnpm catalog). `apps/cli`
already depends on `@megasaver/context-gate`; it never imports
`@megasaver/stats` directly.

**Tech Stack:** TypeScript strict ESM, Vitest, Zod `.strict()` schemas, Citty,
`node:crypto` sha256, injectable git (`ProveGit`) and spawn
(`RunCommandSpawn`) fakes.

## Global Constraints

- **HARD INVARIANT — never touch the user's working tree.** All applies and
  test runs happen inside `git worktree add --detach <mkdtemp dir> <baseSha>`;
  a `finally` runs `worktree remove --force` + `worktree prune` + `rm -rf`.
  The only git commands ever executed with `cwd = repoRoot` are read-only
  (`rev-parse`, `diff`) plus `worktree add/remove/prune` (`.git/worktrees`
  metadata only). Every mutating op (`apply`) runs with `cwd = worktreeDir`.
  Unit tests assert this on the fake git's recorded `(args, cwd)` pairs.
- **Risk HIGH (§12).** Implement on a feature branch in an isolated worktree
  (`feat/context-gate-prove-bite`), no `main` edits. Pre-merge requires
  `code-reviewer` AND `critic` passes in fresh contexts; the implementing
  worker's own check is author-side only and does not satisfy §9.6.
- **TDD, red first.** Every task writes the failing test, runs the RED
  command and confirms failure, then implements. No production code without a
  failing test.
- **Fakes, not processes.** Unit tests never invoke real git and never spawn a
  real child. Mimic the verified harness in `apps/cli/test/output/exec.test.ts`
  (`makeChild` ~:62, `scriptedSpawn` ~:84 — drives the child on `setImmediate`
  so listeners attach first, `inertSpawn` ~:104 for denial branches). Fake
  `ProveGit` records `[args, cwd]` and returns scripted stdout. **No
  timing-tight tests**: `terminated` is simulated by scripting `close(null)`
  (`childExitCode: null` maps to the `terminated` exit per Decision 3), never
  by racing real timers against `--budget-ms`.
- **Closed unions only** (Decision 4). No stringly failure reasons.
  ASSUMPTION: the six INFRA reasons in the spec (`worktree-add-failed`,
  `apply-failed-test-only`, `apply-failed-full`, `spawn-failed`,
  `budget-exceeded`, `command-denied`) are the exhaustive closed union;
  unexpected machinery throws (e.g. a chunk-set store write failure inside a
  phase) are caught at the enclosing stage boundary in `orchestrate.ts` and
  mapped to that stage's reason with the true error in a `detail: string`
  field — never a bite verdict, never a retry.
- **Redaction discipline.** Command and args are redacted element-wise before
  echo and persist (`run-command.ts:289-292` precedent). Excerpts are
  redact-THEN-slice, capped at 400 chars (`run-command.ts:303-307` discipline:
  slicing first can cut a secret). Every echoed string that may carry repo
  content passes `redact` before stdout.
- **Decision 3 — no second exit-code ledger.** No `TokenSaverEvent` rows for
  prove runs; claim-verification-gate owns `childExitCode` persistence on
  token saver events. The attestation record references evidence ONLY as
  chunk-set triples `(workspaceKey, liveSessionId, chunkSetId)`; raw evidence
  lives in overlay chunk sets under existing retention machinery.
- **Atomic writes; no locking.** Attestations use content-store
  `atomicWriteFile`. `withFileLock` (`packages/shared/src/file-lock.ts:25`,
  exported via `@megasaver/shared/node`) is deliberately NOT used: the diff
  hash is the record identity and newest-wins overwrite is specced
  (Decision 5).
- **pytest is v1-denied BY SPEC (resolved — no longer a conflict).** Spec
  Decision 6 and Non-Goals now scope v1 verdict-capable frameworks to vitest
  + `go test`; pytest is detected and derives its locked
  `python3 -m pytest <path>` template, but `python3` is deliberately absent
  from the LOCKED `ALLOWED_COMMANDS`
  (`packages/policy/src/allowed-commands.ts:4-31`; membership is exact-string,
  no basename strip), so under the mandated `evaluateCommand` gate every
  pytest phase deterministically yields `INFRA_FAIL/command-denied` — the
  honest, designed v1 behavior. Implement the template verbatim and keep the
  Task 4 command-denied test as the guard that locks this; do NOT add
  `python3` to policy (tighten-only, locked — pytest enters via its own
  reviewed allowlist change, spec Dependencies / Open questions) and do NOT
  silently rewrite the template.
- **Phase-2 tree state (spec-blessed).** File-granular split means
  test-patch + prod-patch = full diff. Phase 1 applies the test-only patch;
  phase 2 applies the prod-side remainder to the SAME worktree, so the
  resulting tree is byte-identical to base + full diff with no reset/clean
  machinery. `apply-failed-full` covers this remainder apply. The spec's
  Goal/Architecture now say this explicitly ("apply prod-remainder patch
  (tree becomes base + full diff)") — literally re-applying the full patch
  over already-applied test hunks would always conflict.
- **CLI JSON policy.** Failure = human text on stderr, EMPTY stdout, exit 1.
  Success `--json` = one JSON document on stdout. Exit 0 iff verdict `BITES`.
- **Conventions.** §8 file discipline (≤300 LOC per file — the six-module
  split exists for this), conventional commits (subject ≤50 chars,
  imperative), one logical change per task commit. Per-task RED/GREEN via
  package-scoped vitest; full `pnpm verify` is the Task 8 gate.

---

### Task 1: diff-split — classification, cannot-split reasons, diff hash

**Files:**
- `packages/context-gate/src/prove/diff-split.ts` (new)
- `packages/context-gate/test/prove-diff-split.test.ts` (new; the package's test dir is flat — match `packages/context-gate/test/activation-scope.test.ts` naming)

**Interfaces:**

```ts
export type DiffEntry = { status: "A" | "M" | "D" | "R"; path: string; oldPath?: string };
export type CannotSplitReason =
  | "config-file-in-diff"
  | "no-test-changes"
  | "rename-crosses-boundary"
  | "named-test-not-in-test-hunks";
export type SplitResult =
  | { ok: true; testPaths: readonly string[]; prodPaths: readonly string[] }
  | { ok: false; reason: CannotSplitReason; detail: string };
export function parseNameStatus(nameStatusZ: string): DiffEntry[];
export function classifyDiffPaths(entries: readonly DiffEntry[]): SplitResult;
export function detectNamedTestAbsence(input: {
  name: string;
  testPatch: string;
  prodPatch: string;
}): { reason: "named-test-not-in-test-hunks"; detail: string } | null;
export function hashDiff(patchText: string): string; // sha256 hex, 64 chars
```

Implementation notes (real, not sketch):
- TEST globs and EXCLUDED globs are module-level constants compiled once with
  `compileGlob` (policy NFA matcher — never regex, per Decision 2), lists
  copied verbatim from the spec (TEST: `**/*.test.*`, `**/*.spec.*`,
  `**/test/**`, `**/tests/**`, `**/*_test.go`, `**/test_*.py`,
  `**/*_test.py`; EXCLUDED: `**/vitest.config.*`, `**/vite.config.*`,
  `**/jest.config.*`, `**/pytest.ini`, `**/conftest.py`,
  `**/pyproject.toml`, `**/setup.cfg`, `**/go.mod`, `**/go.sum`,
  `**/package.json`, `**/pnpm-lock.yaml`, `**/tsconfig*.json`).
- `parseNameStatus` consumes `git diff --name-status -z` output: NUL-separated
  records; `R<score>` records carry two paths (old, new) and normalize to
  status `"R"` with `oldPath` set.
- `classifyDiffPaths` order: (1) any `path`/`oldPath` matching an EXCLUDED
  glob → `config-file-in-diff` (detail names the first offender); (2) classify
  each side of every entry against TEST globs; a rename whose old and new
  sides classify differently → `rename-crosses-boundary`; (3) zero
  test-classified files → `no-test-changes`; else partition into
  `testPaths` / `prodPaths` (rename entries contribute both old and new path
  to their side so patch `--` pathspecs cover the rename).
- `detectNamedTestAbsence`: scan added lines (`^+` but not `^+++`) of
  `testPatch` for the literal `name`; fire only when it is ABSENT there AND
  PRESENT in `prodPatch` added lines (the mechanized same-file detector —
  spec Decision 2). Absent from both → `null` (absence alone is not proof).
- `hashDiff`: `createHash("sha256").update(patchText).digest("hex")` from
  `node:crypto`.

**Steps:**
- [ ] Write `prove-diff-split.test.ts`: glob matrix (one representative path per TEST glob classifies test; `src/thing.ts` classifies prod; each EXCLUDED glob → `config-file-in-diff`); `no-test-changes` on prod-only diff; rename test→test ok, rename `src/x.ts` → `test/x.test.ts` → `rename-crosses-boundary`; `parseNameStatus` on a NUL-separated blob containing `A`, `M`, `D`, `R100` records; named-test detector fires on prod-side-only presence, null on test-side presence, null on absent-from-both; hash: 64-char hex, stable across two calls, differs on one-byte patch change.
- [ ] RED: `pnpm --filter @megasaver/context-gate exec vitest run test/prove-diff-split.test.ts` — confirm failure (module does not exist).
- [ ] Implement `diff-split.ts` as specified above (pure — no fs, no git, no process).
- [ ] GREEN: rerun the same command — all pass. Then `pnpm --filter @megasaver/context-gate test` for the package suite.
- [ ] Commit: `feat(context-gate): prove diff split and hash`

---

### Task 2: frameworks — deriveTestCommand

**Files:**
- `packages/context-gate/src/prove/frameworks.ts` (new)
- `packages/context-gate/test/prove-frameworks.test.ts` (new)

**Interfaces:**

```ts
export type ProveFramework = "vitest" | "pytest" | "go" | "custom";
export type DerivedCommand = {
  framework: ProveFramework;
  command: string;
  args: readonly string[];
};
export function deriveTestCommand(input: {
  testPath: string;
  name?: string;
  cmdOverride?: string;
}): DerivedCommand;
```

Implementation notes:
- `cmdOverride` wins over everything: whitespace-split into argv, first token
  is `command`, rest are `args`, framework `"custom"`, `name` is NOT spliced
  into an override. No shell quoting support in v1 (`runChild` pins
  `shell: false` at `run-command.ts:131`; no `shell` field exists anywhere in
  prove code).
- Detection from the basename of `testPath` (Decision 6): ends with
  `_test.go` → go; matches `test_*.py` or `*_test.py` → pytest; else vitest.
- Locked templates: vitest → `npx` + `["vitest", "run", testPath]` plus
  `["-t", name]` when named; pytest → `python3` + `["-m", "pytest", testPath]`
  plus `["-k", name]`; go → `go` + `["test", goDir]` plus `["-run", name]`
  where `goDir` = `./` + POSIX dirname of `testPath` (`./.` for a root-level
  file — deterministic and accepted by go).
- Derivation stays pure and total: pytest derives its template like the
  others even though v1 policy denies `python3` downstream (spec Decision 6
  scope; the denial is Task 4's job, not this module's).

**Steps:**
- [ ] Write `prove-frameworks.test.ts`: exact argv equality for all three detections with and without `name`; `pkg/foo/bar_test.go` → go dir `./pkg/foo`; root `bar_test.go` → `./.`; `test_x.py` and `x_test.py` both → pytest; `cmdOverride: "node test/check.mjs"` → `{ framework: "custom", command: "node", args: ["test/check.mjs"] }` (whitespace split — the path is one token); override wins even when `testPath`/`name` are also given, and `name` is not spliced into it; the returned object never contains a `shell` key.
- [ ] RED: `pnpm --filter @megasaver/context-gate exec vitest run test/prove-frameworks.test.ts` — confirm failure.
- [ ] Implement `frameworks.ts` (pure).
- [ ] GREEN: rerun; then package suite.
- [ ] Commit: `feat(context-gate): prove framework derivation`

---

### Task 3: worktree — ProveGit + withDisposableWorktree

**Files:**
- `packages/context-gate/src/prove/worktree.ts` (new)
- `packages/context-gate/test/prove-worktree.test.ts` (new)

**Interfaces:**

```ts
// Mirrors ExecGit (apps/cli/src/git-delta.ts:4) so unit tests never run real git.
export type ProveGit = (args: readonly string[], cwd: string) => string;
export type WorktreeRun<T> = { value: T; cleanupWarnings: readonly string[] };
export async function withDisposableWorktree<T>(input: {
  git: ProveGit;
  repoRoot: string;
  baseSha: string;
  mkdtemp: () => string; // real impl: mkdtempSync(join(tmpdir(), "mega-prove-wt-"))
  rmrf: (path: string) => void; // real impl: rmSync(path, { recursive: true, force: true })
  fn: (worktreeDir: string) => Promise<T>;
}): Promise<WorktreeRun<T>>;
```

Implementation notes:
- `const tmp = input.mkdtemp()`; then
  `git(["worktree", "add", "--detach", tmp, baseSha], repoRoot)` — a throw
  here propagates (orchestrate maps it to `INFRA_FAIL/worktree-add-failed`).
- `try { value = await fn(tmp) } finally { ... }` where the finally
  individually try/catches `git(["worktree","remove","--force",tmp], repoRoot)`,
  `git(["worktree","prune"], repoRoot)`, `rmrf(tmp)`; each failure appends a
  warning string NAMING the leftover tmp path to `cleanupWarnings` (spec Error
  handling: cleanup degrades to a warning, the computed verdict is kept).
  When `fn` threw, cleanup still runs and the original error re-throws after.

**Steps:**
- [ ] Write `prove-worktree.test.ts` with a fake `ProveGit` that pushes `[args, cwd]` into a calls array: success path asserts exact sequence add → (fn ran with tmp dir) → remove → prune → rmrf; every call with `cwd === repoRoot` has `args[0] === "worktree"` (no `apply`/`checkout`/`reset`/`clean` ever against the user repo); `fn` throw → cleanup all runs, error re-thrown; `remove` throw → prune and rmrf still attempted, `cleanupWarnings` contains the tmp path, `value`/error preserved; injected `mkdtemp` returns a fixed string so no real fs is touched.
- [ ] RED: `pnpm --filter @megasaver/context-gate exec vitest run test/prove-worktree.test.ts` — confirm failure.
- [ ] Implement `worktree.ts`.
- [ ] GREEN: rerun; then package suite.
- [ ] Commit: `feat(context-gate): disposable worktree wrapper`

---

### Task 4: run-phase — policy gate → runChild → filterOutput → chunk set → receipt

**Files:**
- `packages/context-gate/src/prove/run-phase.ts` (new)
- `packages/context-gate/test/prove-run-phase.test.ts` (new)

**Interfaces:**

```ts
export type PhaseExit = { kind: "code"; code: number } | { kind: "terminated" };
export type PhaseReceipt = {
  phase: "test-only" | "full";
  exit: PhaseExit;
  commandLabel: string; // redacted element-wise, space-joined
  firstFailure?: string; // redacted, <=400 chars, redact-then-slice
  chunkSet: { workspaceKey: string; liveSessionId: string; chunkSetId: string };
};
export type RunPhaseResult =
  | { ok: true; receipt: PhaseReceipt }
  | { ok: false; reason: "command-denied"; code: PolicyDenyCode }
  | { ok: false; reason: "spawn-failed"; detail: string };
export const MAX_PROVE_BYTES = 20_000_000;
export async function runProvePhase(input: {
  spawn: RunCommandSpawn;
  command: string;
  args: readonly string[];
  worktreeDir: string;
  originPid: string;
  budgetMs: number;
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string; // "prove-<diffHash12>" — overlayChunkSetSchema's liveSessionId is permissive z.string().min(1) (packages/content-store/src/chunk-set.ts:42-55), verified to accept the prefix
  phase: "test-only" | "full";
  now?: () => string;
  newId?: () => string;
}): Promise<RunPhaseResult>;
```

Implementation notes (mirror the shipped overlay path, `run-command.ts:640-665`):
- Redact first: `redactedCommand = redact(command).redacted`,
  `redactedArgs = args.map((a) => redact(a).redacted)`,
  `commandLabel = [redactedCommand, ...redactedArgs].join(" ")`
  (`run-command.ts:289-292`).
- Gate BEFORE spawn: `evaluateCommand({ command, args, project: PROVE_COMMAND_PROJECT, env: { MEGASAVER_ORIGIN_PID: originPid } })`
  where `PROVE_COMMAND_PROJECT = "prove" as unknown as ProjectId` mirrors the
  vestigial placeholder `OVERLAY_COMMAND_PROJECT` (`run-command.ts:57-59`).
  Denied → `{ ok: false, reason: "command-denied", code }`, spawn NEVER
  invoked, nothing persisted. Baseline policy only — v1 does not load
  `.megasaver/permissions.yaml` (spec is silent; `permissions` is optional on
  `EvaluateCommandInput`, `evaluate-command.ts:8-19`).
- `runChild({ spawn, command, args, cwd: worktreeDir, originPid, timeoutMs: budgetMs, maxBytes: MAX_PROVE_BYTES })`
  (`run-command.ts:119` — caller gates first per its contract; it owns
  SIGTERM→SIGKILL). `!outcome.ok` → `spawn-failed` with detail.
- `filterOutput({ raw: outcome.capture.raw, mode: "safe", intent: "prove bite " + phase + " phase", source: { kind: "command", command: redactedCommand, args: redactedArgs } })`
  (`types.ts:208`; input schema `types.ts:36-41`; `"safe"` is a member of
  `tokenSaverModeSchema`, `packages/shared/src/token-saver-mode.ts:7` — HIGH
  risk allows evidence-preserving mode only, §12).
- Exit union: `capture.terminated !== undefined || capture.childExitCode === null`
  → `{ kind: "terminated" }`; else `{ kind: "code", code: capture.childExitCode }`.
- `firstFailure` (only when exit is non-zero or terminated):
  `redact(filtered.excerpts[0]?.text ?? filtered.summary).redacted.slice(0, 400)`
  — `OutputExcerpt.text` verified at
  `packages/output-filter/src/types.ts:78-79`; redact-then-slice order.
- Persist evidence:
  `chunkSet = { chunkSetId: newId(), workspaceKey, liveSessionId, createdAt: now(), source: { kind: "command", command: redactedCommand, args: redactedArgs }, rawBytes: filtered.rawBytes, redacted, chunks: recoverableChunks(outcome.capture.raw) }`
  then `await saveOverlayChunkSet({ storeRoot, chunkSet })` — exact shape of
  the shipped precedent at `run-command.ts:650-665` (`recoverableChunks` is
  imported relatively from `../recoverable-chunks.js`). A throw here
  propagates to orchestrate's stage boundary (Global Constraints ASSUMPTION).

**Steps:**
- [ ] Write `prove-run-phase.test.ts`, copying the harness shapes from `apps/cli/test/output/exec.test.ts` (`makeChild`, `scriptedSpawn` driving on `setImmediate`, `inertSpawn`): scripted `close: 0` → `exit {kind:"code",code:0}`, no `firstFailure`, overlay chunk set written under `(workspaceKey, "prove-abcdef123456", <newId>)` in a real `mkdtemp` storeRoot (assert by loading the file content-store wrote); scripted `close: 1` with vitest-style failure text plus a planted fake secret (e.g. `AWS_SECRET_ACCESS_KEY=...`) → `firstFailure` defined, length ≤ 400, raw secret absent from receipt AND from the persisted chunk-set `source` label; scripted `close: null` → `exit {kind:"terminated"}` (no real timers); scripted `error` → `spawn-failed`; the derived pytest command (`command: "python3", args: ["-m", "pytest", "test_x.py"]` — the v1-denied framework, spec Decision 6) with `inertSpawn` → `command-denied`, `spawn.calls.length === 0`, storeRoot dir stays empty. This case IS the guard that locks the honest pytest denial — do not swap the command for an arbitrary off-list token.
- [ ] RED: `pnpm --filter @megasaver/context-gate exec vitest run test/prove-run-phase.test.ts` — confirm failure.
- [ ] Implement `run-phase.ts`.
- [ ] GREEN: rerun; then package suite.
- [ ] Commit: `feat(context-gate): prove phase runner`

---

### Task 5: attest — schema, verdict matrix, atomic read/write

**Files:**
- `packages/context-gate/src/prove/attest.ts` (new)
- `packages/context-gate/test/prove-attest.test.ts` (new)

**Interfaces:**

```ts
export const phaseExitSchema: z.ZodType<PhaseExit>; // discriminated on "kind", strict objects
export const phaseReceiptSchema: z.ZodType<PhaseReceipt>; // .strict()
export const biteVerdictSchema = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("BITES") }).strict(),
  z.object({
    verdict: z.literal("DOES_NOT_BITE"),
    reason: z.enum(["green-without-fix", "red-with-fix"]),
  }).strict(),
  z.object({
    verdict: z.literal("CANNOT_SPLIT"),
    reason: z.enum(["config-file-in-diff", "no-test-changes", "rename-crosses-boundary", "named-test-not-in-test-hunks"]),
    detail: z.string(),
  }).strict(),
  z.object({
    verdict: z.literal("INFRA_FAIL"),
    reason: z.enum(["worktree-add-failed", "apply-failed-test-only", "apply-failed-full", "spawn-failed", "budget-exceeded", "command-denied"]),
    detail: z.string(),
  }).strict(),
]);
export const biteAttestationSchema = z.object({
  schemaVersion: z.literal(1),
  diffHash: z.string().regex(/^[0-9a-f]{64}$/),
  baseSha: z.string().min(1),
  headSha: z.string().min(1),
  workspaceKey: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  // Redacted derived/override command. Absent IFF the verdict is
  // CANNOT_SPLIT: both split short-circuits (classifyDiffPaths and
  // detectNamedTestAbsence, Task 6 steps 3-4) write the attestation BEFORE
  // deriveTestCommand runs (step 5), so no command label exists yet. Every
  // other verdict kind is produced after derivation and always carries it.
  commandLabel: z.string().optional(),
  verdict: biteVerdictSchema,
  runs: z.array(phaseReceiptSchema).max(2).readonly(),
}).strict();
export type BiteAttestation = z.infer<typeof biteAttestationSchema>;
export function computeVerdict(input: { testOnly: PhaseExit; full?: PhaseExit }): BiteAttestation["verdict"];
export function biteAttestationPath(storeRoot: string, workspaceKey: string, diffHash: string): string;
export function writeBiteAttestation(input: { storeRoot: string; attestation: BiteAttestation }): void;
export function readBiteAttestation(input: { storeRoot: string; workspaceKey: string; diffHash: string }): BiteAttestation | null;
```

ASSUMPTION: the spec locks the verdict union, the receipt content, the path,
and the diff-hash key but not the exact record field list; the field set above
(`schemaVersion`/`baseSha`/`headSha`/`commandLabel`) is the minimal join
surface and is flagged for spec-owner confirmation at review.

Implementation notes:
- `computeVerdict` pure matrix: `testOnly` or `full` terminated →
  `INFRA_FAIL/budget-exceeded` (a bound-kill is NEVER a bite verdict,
  Decision 6); `testOnly` code 0 → `DOES_NOT_BITE/green-without-fix` (`full`
  absent — phase 2 was skipped); `testOnly` nonzero + `full` code 0 →
  `BITES`; `testOnly` nonzero + `full` nonzero → `DOES_NOT_BITE/red-with-fix`.
- Path: `join(storeRoot, "attestations", workspaceKey, "bite", diffHash + ".json")`
  with `assertSafeSegment(workspaceKey)` and `assertSafeSegment(diffHash)`
  (hex → path-safe by construction; guard anyway per Decision 5). Write via
  `atomicWriteFile` after `biteAttestationSchema.parse` (schema-invalid
  throws before any write). Read: ENOENT → `null`; parse on read.

**Steps:**
- [ ] Write `prove-attest.test.ts`: full `computeVerdict` matrix (red→green, green-first, red→red, terminated in either slot); every INFRA reason and every CANNOT_SPLIT reason round-trips write→read; a CANNOT_SPLIT attestation with the `commandLabel` key OMITTED (runs `[]`) parses and round-trips (`exactOptionalPropertyTypes` — the key is absent, not `undefined`); `.strict()` rejects an extra key; overwrite semantics — write two attestations for one hash, read returns the newest; missing file → `null`; the written file re-parses under the schema.
- [ ] RED: `pnpm --filter @megasaver/context-gate exec vitest run test/prove-attest.test.ts` — confirm failure.
- [ ] Implement `attest.ts`.
- [ ] GREEN: rerun; then package suite.
- [ ] Commit: `feat(context-gate): bite attestation and verdict`

---

### Task 6: orchestrate — proveBite wiring, stage-mapped INFRA_FAIL

**Files:**
- `packages/context-gate/src/prove/orchestrate.ts` (new)
- `packages/context-gate/src/index.ts` (edit — export `proveBite`, `ProveBiteInput`, `ProveBiteResult`, `ProveGit`, `BiteAttestation`, `biteAttestationSchema`, `readBiteAttestation`; §8: cross-package import only through the public entry)
- `packages/context-gate/test/prove-orchestrate.test.ts` (new)

**Interfaces:**

```ts
export type ProveBiteInput = {
  repoRoot: string;
  storeRoot: string;
  baseRef: string;
  headRef: string;
  testPath?: string; // required unless cmdOverride
  name?: string;
  cmdOverride?: string;
  budgetMs: number;
  git: ProveGit;
  spawn: RunCommandSpawn;
  mkdtemp: (prefix: string) => string;
  rmrf: (path: string) => void;
  originPid: string;
  now?: () => string;
  newId?: () => string;
};
export type ProveBiteResult = {
  attestation: BiteAttestation;
  cleanupWarnings: readonly string[];
};
export async function proveBite(input: ProveBiteInput): Promise<ProveBiteResult>;
```

Implementation notes (mirrors the spec Architecture block):
1. Resolve (read-only, `cwd = repoRoot`):
   `baseSha = git(["rev-parse", baseRef + "^{commit}"], repoRoot).trim()`,
   same for `headSha`; `fullPatch = git(["diff", "--binary", baseSha, headSha], repoRoot)`;
   `nameStatus = git(["diff", "--name-status", "-z", baseSha, headSha], repoRoot)`.
   Resolve-stage git throws (well-formed but non-existent ref, unreadable
   repo) deliberately PROPAGATE out of `proveBite`: they happen before
   `diffHash` exists, so no attestation identity exists to write — the CLI
   (Task 7) catches them and renders the stderr+empty-stdout failure shape.
   The closed INFRA union intentionally has no resolve-stage reason.
2. `diffHash = hashDiff(fullPatch)`;
   `workspaceKey = encodeWorkspaceKey(repoRoot)`;
   `liveSessionId = "prove-" + diffHash.slice(0, 12)`.
3. `classifyDiffPaths(parseNameStatus(nameStatus))` — failure → write a
   `CANNOT_SPLIT` attestation (runs: `[]`, `commandLabel` key OMITTED — the
   short-circuit precedes `deriveTestCommand` in step 5, so no command label
   exists; Task 5 schema comment) and return WITHOUT any worktree or spawn
   (short-circuit before worktree, budget saved). The step-4
   `detectNamedTestAbsence` short-circuit writes the identical shape.
4. Side patches (read-only diffs):
   `testPatch = git(["diff", "--binary", baseSha, headSha, "--", ...testPaths], repoRoot)`,
   `prodPatch = git(["diff", "--binary", baseSha, headSha, "--", ...prodPaths], repoRoot)`
   (skip the prod diff call when `prodPaths` is empty). When `name` is given,
   `detectNamedTestAbsence({ name, testPatch, prodPatch })` firing → the same
   `CANNOT_SPLIT` short-circuit.
5. `deriveTestCommand({ testPath, name, cmdOverride })`; `commandLabel` from
   element-wise redaction of the derived command.
6. Patch staging: `patchDir = mkdtemp("mega-prove-patch-")`; write
   `test-only.patch` / `prod-remainder.patch` with `writeFileSync`;
   orchestrate-level `try/finally` runs `rmrf(patchDir)` (patches can carry
   repo content — never left behind).
7. `withDisposableWorktree({ git, repoRoot, baseSha, mkdtemp: () => mkdtemp("mega-prove-wt-"), rmrf, fn })`;
   inside `fn(worktreeDir)`, each stage try/caught to its closed reason:
   - `git(["apply", "--whitespace=nowarn", testOnlyPatchPath], worktreeDir)`
     → throw maps to `INFRA_FAIL/apply-failed-test-only`.
   - Phase 1 `runProvePhase(..., phase: "test-only")`: `command-denied` →
     `INFRA_FAIL/command-denied`; `spawn-failed` → `INFRA_FAIL/spawn-failed`;
     receipt `exit.kind === "terminated"` → `INFRA_FAIL/budget-exceeded`.
   - Phase-1 exit code 0 → verdict `DOES_NOT_BITE/green-without-fix`, phase 2
     SKIPPED (runs: `[receipt1]`).
   - Non-empty `prodPatch` →
     `git(["apply", "--whitespace=nowarn", prodPatchPath], worktreeDir)`
     → throw maps to `INFRA_FAIL/apply-failed-full` (tree is now base + full
     diff per Global Constraints). Empty `prodPatch` → no apply (the diff was
     test-only; phase 2 runs on the same tree and honestly yields
     `red-with-fix`).
   - Phase 2 `runProvePhase(..., phase: "full")`, same INFRA mappings.
   - `computeVerdict({ testOnly, full })`.
8. Worktree-add throw → `INFRA_FAIL/worktree-add-failed`. Every INFRA path
   still writes the attestation (runs hold whatever receipts completed).
   `writeBiteAttestation` always runs for all four verdict kinds; return
   `{ attestation, cleanupWarnings }`. No retries anywhere (§13).

**Steps:**
- [ ] Write `prove-orchestrate.test.ts` with a scripted fake git (dispatch on `args[0]`/`args[1]`, returning canned shas, a canned full patch, canned `-z` name-status) plus the Task 4 spawn harness: BITES end-to-end (phase 1 close 1, phase 2 close 0) — attestation verdict `BITES`, `runs.length === 2` with distinct chunkSetIds and both triples carrying `liveSessionId === "prove-" + hash12`, and NO fake-git call with `cwd === repoRoot` whose `args[0]` is `apply`; `green-without-fix` (phase 1 close 0) — `runs.length === 1`, spawn invoked exactly once; `red-with-fix` (both close 1); CANNOT_SPLIT short-circuit (prod-only diff) — no `worktree` call, no spawn call, attestation still written with `runs: []` and NO `commandLabel` key (`"commandLabel" in attestation === false`); INFRA matrix — worktree add throws, test-only apply throws, prod apply throws, spawn error, denial (command off the allow-list), terminated (close null) — each maps to its exact reason, carries `commandLabel`, and `readBiteAttestation` returns the record; resolve-stage throw (fake git throws on `rev-parse`) — `proveBite` rejects, and NO attestation file exists anywhere under the store (the CLI owns rendering, Task 7).
- [ ] RED: `pnpm --filter @megasaver/context-gate exec vitest run test/prove-orchestrate.test.ts` — confirm failure.
- [ ] Implement `orchestrate.ts`; add the public exports to `packages/context-gate/src/index.ts`.
- [ ] GREEN: rerun; then `pnpm --filter @megasaver/context-gate test` and `pnpm --filter @megasaver/context-gate typecheck` (project refs must still build).
- [ ] Commit: `feat(context-gate): prove bite orchestrator`

---

### Task 7: CLI — `mega prove bite` command

**Files:**
- `apps/cli/src/commands/prove/bite.ts` (new)
- `apps/cli/src/commands/prove/index.ts` (new — `prove` group)
- `apps/cli/src/errors.ts` (edit — add `proveRangeInvalidMessage`, `proveTestPathRequiredMessage`, `proveBudgetInvalidMessage`, mimicking the `CliMessage` helpers, e.g. `sessionNotFoundMessage` at `apps/cli/src/errors.ts:57`)
- `apps/cli/src/main.ts` (edit — import `proveCommand` from `./commands/prove/index.js` and register it, matching the pattern at `apps/cli/src/main.ts:3-27`)
- `apps/cli/test/prove-bite.test.ts` (new)
- `apps/cli/test/errors.test.ts` (edit — cover the three new helpers alongside the existing ones)

**Interfaces** (per `wiki/workflows/cli-test-pattern.md` — thin Citty handler
over an injectable inner function):

```ts
export type RunProveBiteInput = {
  range: string | undefined; // positional, default "HEAD~1..HEAD"
  testPath: string | undefined;
  name: string | undefined;
  cmd: string | undefined;
  budgetMs: string | undefined; // raw flag, re-parsed here
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  // injection seams for tests; default to real execFileSync git / node spawn / fs
  git?: ProveGit;
  spawn?: RunCommandSpawn;
  mkdtemp?: (prefix: string) => string;
  rmrf?: (path: string) => void;
};
export async function runProveBite(input: RunProveBiteInput): Promise<0 | 1>;
export const proveBiteCommand: /* citty */ CommandDef;
```

Implementation notes:
- Parse-on-handoff (§8 policy): the range and budget are re-parsed at the CLI
  boundary because a garbage ref reaches `git rev-parse` and a garbage budget
  reaches the child-kill timer — downstream crash/corruption risk. Range:
  split on `..`, both halves non-empty, no whitespace → else
  `proveRangeInvalidMessage(value)` on stderr, empty stdout, exit 1. Budget:
  integer 1..600_000, default 300_000 → else `proveBudgetInvalidMessage`.
  `--test` required unless `--cmd` given → else
  `proveTestPathRequiredMessage`.
- Default real seams: `git` via
  `execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })`
  (the `ExecGit` shape, `apps/cli/src/git-delta.ts:4-14` precedent — but NOT
  its bounds: git-delta pins `timeout: 3000` + `maxBuffer: 10MB` as a
  session-start stall guard, while a full `git diff --binary` over a large
  range can legitimately exceed both; Node's default `maxBuffer` is 1MB, so
  omitting it would make big diffs throw at the resolve stage. No `timeout`
  here — `--budget-ms` bounds the child test runs, not git);
  `spawn` = node `spawn`; `mkdtemp`/`rmrf` from `node:fs`.
  `originPid = String(process.pid)` (`evaluateCommand` compares the env value
  against the live pid — `evaluate-command.ts:24-27`).
- Resolve-stage throws: wrap the `proveBite` call in try/catch. A throw can
  only escape `proveBite` from the resolve stage (Task 6 note 1 — before
  `diffHash` exists, no attestation is written; every later stage maps to
  INFRA_FAIL inside the attestation). Render it as
  `proveRangeInvalidMessage(range, String(err))` on stderr (extend the helper
  with an optional `detail` second parameter), EMPTY stdout, exit 1 — the
  same shape as the format-validation failures, now also covering
  well-formed-but-non-existent refs and maxBuffer overflows.
- Success rendering (table mode): verdict line, reason/detail when present,
  `diffHash`, then one block per run — phase, exit, `commandLabel`,
  `firstFailure`, chunk triple. EVERY echoed line passes
  `redact(line).redacted` before `stdout` (receipts are already redacted;
  the second pass is the spec's echo discipline). `cleanupWarnings` go to
  stderr as warnings even on exit 0. `--json`: one
  `JSON.stringify({ attestation, cleanupWarnings })` on stdout. Exit 0 iff
  `verdict.verdict === "BITES"`; every other verdict exits 1 with the
  rendering still on stdout (the verdict IS the successful output of the
  tool; only argument/infra-input errors use the stderr+empty-stdout shape).

**Steps:**
- [ ] Write `apps/cli/test/prove-bite.test.ts` per the cli-test-pattern (console spies, `process.exitCode` reset, `mkdtemp` store, handler driven via `proveBiteCommand.run?.({ args, cmd: proveBiteCommand, rawArgs: [], data: undefined } as never)` for the arg-validation paths, and direct `runProveBite` calls with the Task 6 fake git + scripted spawn for verdict paths): bad range `"HEAD~1.."` → stderr message, EMPTY stdout, exit 1; well-formed but non-existent ref (`"typo-branch..HEAD"` with a fake git whose `rev-parse` throws like real git) → stderr contains the range message AND the git detail, EMPTY stdout, exit 1, and no attestation path was written; missing `--test` without `--cmd`; `--budget-ms 0` and `700000` → invalid; BITES path → table contains verdict, both phases, chunk triple, exit code 0; `--json` → stdout parses, `attestation.verdict.verdict === "BITES"`; DOES_NOT_BITE and INFRA_FAIL paths → exit 1; redacted echo — scripted child output carries a planted secret, assert no spy call contains the raw secret.
- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/prove-bite.test.ts` — confirm failure.
- [ ] Implement `bite.ts`, `prove/index.ts`, the three `errors.ts` helpers, and the `main.ts` registration.
- [ ] GREEN: rerun; then `pnpm --filter @megasaver/cli test` and `pnpm --filter @megasaver/cli typecheck`.
- [ ] Commit: `feat(cli): mega prove bite command`

---

### Task 8: integration test, changeset, full verification

**Files:**
- `apps/cli/test/prove-bite-integration.test.ts` (new — the ONE real-repo test)
- `.changeset/prove-bite-attestation.md` (new)

The fixture mimics the verified real-repo harness in
`apps/cli/test/hooks/warmup-integration.test.ts:13-31` (execFileSync git,
`mkdtempSync` repo + store, `afterEach` rmSync), extended to a two-commit
red→green shape:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let store: string;
let repo: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-prove-store-"));
  repo = mkdtempSync(join(tmpdir(), "megasaver-prove-repo-"));
  git(["init"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "logic.mjs"), "export const add = (a, b) => a - b;\n"); // buggy base
  git(["add", "."], repo);
  git(["commit", "-m", "base"], repo);
  mkdirSync(join(repo, "test"));
  writeFileSync(
    join(repo, "test", "check.mjs"),
    'import { add } from "../logic.mjs";\nif (add(2, 2) !== 4) { console.error("FAIL: add(2,2) !== 4"); process.exit(1); }\n',
  );
  writeFileSync(join(repo, "logic.mjs"), "export const add = (a, b) => a + b;\n"); // the fix
  git(["add", "."], repo);
  git(["commit", "-m", "fix add and add biting test"], repo);
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});
```

The single test drives `proveBite` with REAL seams — `git` as above, real
`spawn`, an `mkdtemp` wrapper that records every returned path — over
`HEAD~1..HEAD`, `cmdOverride: "node test/check.mjs"` (`node` is in
`ALLOWED_COMMANDS`, `allowed-commands.ts:16`), `budgetMs: 60_000` (a hang
guard only; no assertion depends on elapsed time). `test/check.mjs` classifies
as test via `**/test/**`; `logic.mjs` is prod; phase 1 (base + test only) exits
1, phase 2 (full) exits 0.

Assertions: verdict `BITES` with `runs.length === 2`; user repo untouched —
`git(["rev-parse", "HEAD"], repo)` identical before/after and
`git(["status", "--porcelain"], repo)` returns `""`; every recorded mkdtemp
path no longer exists (`existsSync === false`) and
`git(["worktree", "list"], repo)` shows only the main tree; the attestation
file exists at `store/attestations/<workspaceKey>/bite/<diffHash>.json` and
parses under `biteAttestationSchema`; both receipts' chunk sets load from the
store.

**Steps:**
- [ ] Write `prove-bite-integration.test.ts` exactly as above.
- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/prove-bite-integration.test.ts` — must fail only if Tasks 1–7 left a real-seam gap; a first-run pass is acceptable here (the unit layers were test-first; this layer is the evidence gate).
- [ ] GREEN: rerun until pass WITHOUT touching the assertions to fit bugs — fix the product instead (superpowers:systematic-debugging on any failure).
- [ ] Changeset `.changeset/prove-bite-attestation.md`: minor bump for `@megasaver/context-gate` and `@megasaver/cli` — "Add `mega prove bite`: red→green test-bite proving in a disposable worktree with diff-hash attestations." (DoD #9 — public API changed).
- [ ] Full gate: `pnpm verify` (biome + tsc project refs + vitest) — green, output captured.
- [ ] DoD #5 smoke evidence: from a scratch clone of the fixture shape, run the built CLI `mega prove bite --cmd "node test/check.mjs"` and capture the terminal session (BITES, exit 0) plus one `DOES_NOT_BITE/green-without-fix` run (commit a test that passes on base).
- [ ] Confirm zero pending TodoWrite items for the feature (DoD #8).
- [ ] Commits: `test(cli): prove bite integration on real repo` then `chore: changeset for prove bite`
- [ ] Hand off per superpowers:requesting-code-review — `code-reviewer` AND `critic` in fresh contexts (HIGH risk, §9.6; author ≠ reviewer), explicitly pointing reviewers at the flagged ASSUMPTION (attestation field set) and the two spec-resolved decisions to re-check: pytest's v1 policy-denied scope (spec Decision 6 / Non-Goals) and the phase-2 remainder-apply wording (spec Goal / Architecture).
