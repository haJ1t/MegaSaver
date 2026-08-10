---
feature: test-bite-proof
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "15 of 20 (wave-2 batch)"
---

# Test-Bite Proof (`mega prove bite`)

## Problem

A claimed fix ships with a regression test — but nothing proves the
test *bites*: that it fails without the fix and passes with it. Tests
that pass in both worlds ("test theater") satisfy every existing gate:
claim-verification-gate (C3, batch 1) proves a run HAPPENED with exit
0; it cannot prove the test discriminates fix-present from fix-absent.
The red→green evidence exists only if someone manually checks out the
base, and nobody does. The operator's delegation rule ("a worker's
claim is not a passing test") needs a mechanized counterpart for the
test itself.

## Goal

`mega prove bite [<base>..<head>]`: in a DISPOSABLE git worktree,
apply only the diff's TEST hunks and run the named test expecting RED;
then bring the tree to the full-diff state (apply the prod-side
remainder patch) expecting GREEN. Both runs are captured as receipts
(exit code + parser-extracted first failure) and stamped into a bites
/ does-not-bite attestation joined to the diff hash.

## Non-Goals (YAGNI)

- No dirty working-tree proving. v1 proves a committed range only
  (default `HEAD~1..HEAD`) — the diff hash must be deterministic.
- No hunk-level splitting inside one file. Split is file-granular;
  same-file test+prod mixing → honest `CANNOT_SPLIT`, never guessed.
- No sandbox and no network isolation (see Security — documented
  limitation, not an accident).
- No flake detection or retries: one run per phase; `red-with-fix` is
  reported, never re-run (§13: no silent retries).
- No verdict-capable frameworks beyond vitest + `go test` in v1.
  pytest is DETECTED and derives its locked template, but remains
  policy-denied (honest `INFRA_FAIL/command-denied`, Decision 6)
  until `ALLOWED_COMMANDS` gains `python3` in its own reviewed
  change — see Dependencies and Open questions.
- No `TokenSaverEvent` rows for prove runs — C3's exit-code
  persistence mechanism is not duplicated (Decision 3).

## Locked Decisions

1. **Worktree isolation is the HARD INVARIANT.** All applies and runs
   happen in `git worktree add --detach <mkdtemp dir> <base>`; a
   `finally` block runs `git worktree remove --force` + `git worktree
   prune` + `rm -rf <tmp>`. The user's working tree and index are
   NEVER written. The only user-repo git ops are read-only queries
   (`rev-parse`, `diff`) plus worktree add/remove/prune, which touch
   `.git/worktrees` metadata only — git's sanctioned mechanism. Git is
   injectable (`ProveGit`, mirroring `ExecGit` in
   `apps/cli/src/git-delta.ts:4`) so unit tests never invoke real git.
2. **File-granular split via `compileGlob`** (policy NFA matcher —
   never regex, [[concepts/glob-compile-redos]]). TEST globs:
   `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`,
   `**/*_test.go`, `**/test_*.py`, `**/*_test.py`. EXCLUDED
   (framework config — changing them changes both runs):
   `**/vitest.config.*`, `**/vite.config.*`, `**/jest.config.*`,
   `**/pytest.ini`, `**/conftest.py`, `**/pyproject.toml`,
   `**/setup.cfg`, `**/go.mod`, `**/go.sum`, `**/package.json`,
   `**/pnpm-lock.yaml`, `**/tsconfig*.json`. Ambiguity is never
   guessed — `CANNOT_SPLIT` with a machine reason fires on: excluded
   config in the diff (`config-file-in-diff`), zero test-classified
   files (`no-test-changes`), a rename crossing the test/prod boundary
   (`rename-crosses-boundary`), or `--name` given but absent from the
   test-side added lines while present in prod-side added lines
   (`named-test-not-in-test-hunks` — the mechanized detector for the
   same-file case: the named test lives in a prod-classified file).
3. **Receipts reuse shipped seams; no new mechanisms.** Bounded
   execution via the exported `runChild`
   (`packages/context-gate/src/run-command.ts` — caller gates with
   `evaluateCommand` first, per its contract). First-failure excerpt
   via `filterOutput` (`@megasaver/output-filter`) — the
   pytest/go/vitest parsers ride inside it and it redacts raw as its
   first step. Evidence chunks via `saveOverlayChunkSet`, keyed
   `(workspaceKey, liveSessionId: "prove-<diffHash12>", chunkSetId)`
   — references always carry the full triple
   ([[concepts/chunk-set-identity]]). Exit encoding consumes C3's
   `childExitCode` convention: `{kind:"code";code} |
   {kind:"terminated"}`; a bound-killed child (`childExitCode: null`)
   maps to `terminated`. Receipts live ONLY in the attestation record
   — no event-row twin.
4. **Verdict is a closed 4-member union.**
   - `BITES` — test-only RED, then full-diff GREEN. CLI exit 0.
   - `DOES_NOT_BITE` — the run pair failed to discriminate. Reason
     `green-without-fix` (test-only run GREEN — the smoking gun; the
     full phase is skipped, budget saved) or `red-with-fix` (both
     RED — the test cannot detect the fix's presence; fix refuted or
     flaky). CLI exit 1.
   - `CANNOT_SPLIT` — Decision 2 reasons. CLI exit 1.
   - `INFRA_FAIL` — machinery failed (`worktree-add-failed`,
     `apply-failed-test-only`, `apply-failed-full` — the
     prod-remainder apply that brings the tree to base + full diff —
     `spawn-failed`, `budget-exceeded`, `command-denied`). NEVER
     mapped to a bite verdict. CLI exit 1.
5. **Attestation joined to the diff hash.** `diffHash` = sha256 (hex)
   of the full `git diff --binary <base> <head>` patch text. Record at
   `<storeRoot>/attestations/<workspaceKey>/bite/<diffHash>.json`,
   written with content-store `atomicWriteFile`, path segments guarded
   by `assertSafeSegment` (hash is hex → path-safe by construction).
   Zod `.strict()` schema; re-running overwrites (the hash is the
   identity; newest attestation wins).
6. **Budgets and command derivation.** Per-phase `--budget-ms`
   (default 300_000, 1..600_000) and 20_000_000 `maxBytes` enforced by
   `runChild`'s own bounds; a bound-killed phase is
   `INFRA_FAIL/budget-exceeded`, never a bite verdict. Framework
   detected from `--test <path>` (`*_test.go` → go, `test_*.py` /
   `*_test.py` → pytest, else vitest); locked templates: vitest
   `npx vitest run <path>` (+ `-t <name>`), pytest
   `python3 -m pytest <path>` (+ `-k <name>`), go
   `go test ./<dir>` (+ `-run <name>`). `--cmd` escape hatch:
   whitespace-split argv, `shell: false`. Every command passes
   `evaluateCommand` before spawn (denial → `command-denied`).
   **v1 scope: pytest is derivable but policy-denied.** `python3` is
   deliberately absent from the LOCKED `ALLOWED_COMMANDS`
   (`packages/policy/src/allowed-commands.ts:4-31`; exact-string
   membership), so under the mandatory gate every pytest phase
   deterministically yields `INFRA_FAIL/command-denied` — an honest,
   tested denial, never a fabricated verdict. v1 verdict-capable
   frameworks are vitest and `go test` only. This feature does NOT
   widen `ALLOWED_COMMANDS`; pytest becomes verdict-capable with zero
   code change here when the allowlist gains `python3` through its
   own reviewed policy change (see Dependencies / Open questions).

## Architecture

```
mega prove bite [<base>..<head>] --test <path> [--name <t>] [--cmd ...]
  -> resolve refs + full diff + name-status   (ProveGit, read-only)
  -> classifyDiffPaths (compileGlob)  --ambiguous--> CANNOT_SPLIT
  -> hashDiff (sha256 of full patch)
  -> git worktree add --detach <mkdtemp> <base>       [finally: remove]
  -> apply test-only patch -> runChild (RED expected)  -> PhaseReceipt
       green? -> DOES_NOT_BITE/green-without-fix (skip phase 2)
  -> apply prod-remainder patch (tree becomes base + full diff;
     re-applying the full patch over the applied test hunks would
     conflict)          -> runChild (GREEN expected)-> PhaseReceipt
  -> computeVerdict -> writeBiteAttestation(diffHash, runs, verdict)
       each PhaseReceipt: exit union + filterOutput first-failure
                          + saveOverlayChunkSet evidence triple
```

## Components

1. `packages/context-gate/src/prove/diff-split.ts` — pure:
   `classifyDiffPaths(entries)` → `{ testPaths, prodPaths }` or
   cannot-split reason; `hashDiff(patchText)`.
2. `packages/context-gate/src/prove/frameworks.ts` —
   `deriveTestCommand({ testPath, name?, cmdOverride? })` → closed
   `{ framework, command, args }`.
3. `packages/context-gate/src/prove/worktree.ts` — `ProveGit` type;
   `withDisposableWorktree(git, repoRoot, baseRef, mkdtemp, fn)` with
   guaranteed `finally` cleanup.
4. `packages/context-gate/src/prove/run-phase.ts` — policy gate →
   `runChild` → `filterOutput` (mode `"safe"` — HIGH risk allows
   evidence-preserving only, §12) → `recoverableChunks` →
   `saveOverlayChunkSet` → `PhaseReceipt`.
5. `packages/context-gate/src/prove/attest.ts` —
   `biteAttestationSchema` (`.strict()`), `computeVerdict(phases)`,
   `writeBiteAttestation` / `readBiteAttestation`.
6. `packages/context-gate/src/prove/orchestrate.ts` — `proveBite`
   wiring 1–5; every machinery throw maps to `INFRA_FAIL`.
7. `apps/cli/src/commands/prove/bite.ts` + `index.ts` — Citty
   command per [[workflows/cli-test-pattern]]; `prove` group
   registered in `apps/cli/src/main.ts`; `--json`.

## Error handling

- All failure reasons are closed unions (Decision 4); no stringly
  reasons. Machinery exceptions are caught once, in `orchestrate.ts`,
  and become `INFRA_FAIL` — never a bite verdict, never a retry.
- CLI follows the JSON policy: failure = text on stderr, empty
  stdout, exit 1. New helpers in `apps/cli/src/errors.ts`
  (`proveRangeInvalidMessage`, `proveTestPathRequiredMessage`,
  `proveBudgetInvalidMessage`).
- Every echoed string that may carry repo content (command line,
  first-failure excerpt, patch paths) passes `redact` before stdout;
  excerpts are capped at 400 chars, redact-then-slice order (the
  run-command.ts:307 discipline: slicing first can cut a secret).
- Cleanup failures in `finally` degrade to a warning on stderr — the
  verdict already computed is not discarded, but the leftover tmp path
  is named.

## Security & privacy

> **`mega prove bite` EXECUTES PROJECT CODE.** Both phases run the
> repo's test command (vitest/pytest/go or `--cmd`) with the
> invoking user's privileges and environment — the same trust level
> as the user running tests by hand. A malicious diff or test file
> gets arbitrary code execution BY DESIGN. The worktree isolates the
> user's working tree, NOT the host: v1 has no sandbox and does not
> block network access from the child (documented limitation; the
> tool itself performs zero network IO). Do not point it at diffs
> you would not run `pnpm test` on.

- `evaluateCommand` gates the derived/overridden command before spawn
  — a policy tripwire, not a sandbox; stated as such.
- Execution budget (Decision 6) bounds runaway children; `runChild`
  owns SIGTERM→SIGKILL.
- `filterOutput` redacts raw before anything persists; command and
  args are redacted element-wise before echo and persist
  (run-command.ts:289 precedent). Attestation stores redacted labels
  and excerpts only; raw evidence lives in chunk sets under the
  existing retention machinery.

## Testing (TDD — red first; detail in plan)

| Layer | Test |
|-------|------|
| diff-split | glob matrix (test/prod/excluded), all 4 cannot-split reasons, rename statuses, hash stability + change sensitivity |
| frameworks | 3 detections, template argv exact, `--name` splicing, `--cmd` override wins, no `shell` |
| worktree | fake `ProveGit` call-sequence assertions; cleanup runs on success AND on throw; user-repo args never include mutating ops |
| run-phase | fake spawn (scripted `close`, mimic `apps/cli/test/output/exec.test.ts` harness): exit union mapping incl. `terminated`, chunk-set triple persisted, policy denial → no spawn |
| attest | full verdict matrix (red→green, green, red→red, each infra reason); schema strict round-trip; atomic overwrite |
| orchestrate | end-to-end with fake git + fake spawn: BITES, both DOES_NOT_BITE reasons, phase-2 skip on green, CANNOT_SPLIT short-circuits before worktree |
| CLI | [[workflows/cli-test-pattern]]: table + `--json` shapes, exit codes 0/1, failure paths, redacted echo |
| integration | ONE real fixture repo (`git init` + commits, mimicking `apps/cli/test/hooks/warmup-integration.test.ts`): real worktree, real apply, red→green via `--cmd "node check.mjs"`; asserts HEAD sha unchanged, `git status --porcelain` empty, tmp worktree removed |

No timing-tight assertions anywhere: phase outcomes are driven by
scripted fake children, never by real timers racing wall-clock.

## Risk & process

**HIGH** (§12): executes project code, touches `.git/worktrees`
metadata in user repos, public CLI flags. Mandatory: full chain +
`architect` design pass + `critic` adversarial review + worktree (no
`main` edits). Reviewers: `code-reviewer` AND `critic`, separate
passes, never the authoring context. Skill mode: evidence-preserving
only (locked into phase runs via mode `"safe"`).

**Escalation → CRITICAL** if implementation ever mutates a user repo
beyond `.git/worktrees` metadata, deletes user data, or grows an
unsupervised re-run loop.

## Dependencies / build order

Build order 15 of 20 (wave-2 batch). Consumes batch-1
claim-verification-gate (build-order 3) as convention, not code: the
`childExitCode` null/absent semantics and the receipt exit union are
mirrored, and its event-row persistence is deliberately NOT duplicated
(Decision 3). Everything else is shipped surface: `runChild` /
`RunCommandSpawn` / `recoverableChunks` (context-gate),
`filterOutput` (output-filter), `saveOverlayChunkSet` /
`atomicWriteFile` / `assertSafeSegment` (content-store),
`compileGlob` / `redact` / `evaluateCommand` (policy),
`encodeWorkspaceKey` (shared). No new packages, no new external deps
(repo uses workspace protocol; there is no pnpm catalog). Changeset:
context-gate + cli (DoD #9).

pytest verdict-capability additionally depends on a FUTURE reviewed
policy change adding `python3` to `ALLOWED_COMMANDS`
(`packages/policy/src/allowed-commands.ts` — LOCKED, out of scope for
this feature). Until then the pytest path ends at the honest
`INFRA_FAIL/command-denied` (Decision 6); the plan's command-denied
test locks that interim behavior.

## Open questions

- A green phase that selected zero tests (e.g. vitest `-t` matching
  nothing) can fake `green-without-fix` credibility in reverse; v1
  treats the exit code as authority. Candidate v2: require ≥1
  executed test parsed from the run output before trusting green.
- Dirty working-tree proving (uncommitted claimed fixes) — deferred;
  needs a deterministic hash for an unstable diff.
- pytest enters as a verdict-capable framework when `ALLOWED_COMMANDS`
  gains `python3` (its own reviewed policy change, not this feature).
  That review should also decide whether the locked
  `python3 -m pytest` template stands or moves to bare `pytest`
  (already in the allowlist) — changing the template now was rejected
  in favor of honest scope reduction.
- Multi-test proving (`--name` repeated) — additive later; verdict
  semantics per-name are unclear when results diverge.
