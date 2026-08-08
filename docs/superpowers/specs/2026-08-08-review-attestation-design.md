---
feature: review-attestation
date: 2026-08-08
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "4 of 5 (2026-08-08 self-audit batch)"
---

# Review Attestation — receipts that prove a review covered the code that shipped

## Problem

This repo's own `docs/conventions/git-and-commits.md` requires "Reviewer
agent pass" before merge, and `docs/conventions/anti-patterns.md` states
`No author == reviewer` as a hard gate. `wiki/log.md` has 12+ entries
asserting this happened (`"Review: code-reviewer + critic both ship
(fresh contexts)"`, `"author≠reviewer"`, etc. — grep confirms the phrase
recurring at lines 281, 1888, 1972, 3673, 7443, 8834 and others). But
every one of those assertions is a **sentence written by the same agent
that is claiming compliance** — there is no artifact anywhere in this
repo that a human or a future agent can check to confirm: (a) a review
actually happened, (b) it covered the EXACT code that shipped (not an
earlier or later revision), and (c) nothing changed between "approved"
and "merged." This is the identical shape as the problem
`claim-verification-gate` (batch-1, build 3) already fixed for test
claims — "tests pass" without a receipt — applied to the review claim
specifically, which that pair explicitly does not cover (its Non-Goals
list "claim-category ↔ receipt-command semantic matching," and a review
claim is not a command-exit claim at all).

Compounding this: `review-packs` (batch build 8, this repo's existing
in-flight HIGH-risk spec) builds the evidence bundle a reviewer reads
(diff + context + test receipts) but explicitly does **not** record
that a review happened or verdict was reached — its own Non-Goals say
"Scoring/judging the code... zero verdicts." So even once review-packs
ships, there is still no durable record that connects "this diff hash"
→ "this reviewer verdict" → "this is still the diff hash at merge
time." A reviewer could approve commit A, and commit B could ship
instead (a stale approval) with nothing in the repo able to detect it.

## Goal

A tiny, local, git-native attestation record: when a reviewer subagent
(or the `code-reviewer`/`critic` roles this repo's process already
names) finishes a review, `mega review attest <base>..<head> --verdict
<approve|request-changes|needs-work> [--reviewer <label>]` writes one
append-only, content-addressed record capturing the diff hash, the
verdict, a timestamp, and an optional free-text reviewer label — NOT
an identity claim (Non-Goal below). `mega review check <base>..<head>`
then answers, deterministically: "is there an attestation whose diff
hash matches the CURRENT diff for this range, and what did it say?" —
so a stale approval (diff changed after approval) is instantly,
mechanically visible instead of trusted on an agent's word.

## Non-Goals

- **No cryptographic identity, no proof that two different AGENTS (as
  opposed to two different INVOCATIONS) produced the author and
  reviewer attestations.** This repo has no mechanism to distinguish
  "a genuinely fresh subagent context" from "the same agent typing a
  different message" — inventing one is a much larger, separate
  research problem (session provenance, sandboxing) this spec does not
  attempt. What this DOES provide: a durable, checkable record that
  the review verdict was recorded against a SPECIFIC, HASHABLE diff —
  which is the part that is checkable today, and the part
  `claim-verification-gate`'s own precedent (measure what you can,
  say so honestly about what you can't) endorses.
- **No merge gate, no CI enforcement, no git hook.** `mega review
  check`'s exit code is informational in v1 (report-only, like
  `claim-verification-gate`'s default un-`--strict` mode) — wiring it
  into a required check is a follow-up, not this spec (YAGNI: prove
  the mechanism reports correctly before making it a gate anyone can
  be blocked by).
- **No GitHub/PR API integration.** Local git only, same boundary
  `review-packs` already draws for itself.
- **No re-implementation of review-packs' diff/context bundling.**
  This spec is deliberately smaller and independent: it attests to a
  diff HASH (one `git diff <base>..<head> | sha256`), not the full
  semantic-chunked bundle review-packs builds. If review-packs ships
  first, `mega review attest` can OPTIONALLY reference a review-pack's
  `packId` (Locked Decision 5); if it ships later or never, attestation
  still works standalone — no hard dependency either direction.
- **No automatic verdict determination.** The verdict is exactly what
  the caller passes; this command records a claim, it does not judge
  code (matches review-packs' own "zero verdicts" boundary — the two
  specs draw the same line from opposite sides: review-packs never
  verdicts, review-attestation never judges, only records).

## Locked Decisions

1. **Diff hash = `sha256(git diff --no-color <base>..<head>)`, hex,
   full 64 chars — not truncated** (unlike `hashContent`'s 16-char
   slices used elsewhere for compact keys; a security-adjacent
   integrity check should not truncate its own hash). Computed via the
   repo's existing `execFileSync("git", …)` pattern
   (`packages/core/src/memory-anchor.ts:82`'s `defaultExecGit` — same
   timeout/stdio/maxBuffer discipline, reused not reinvented).
2. **Storage: append-only JSONL, one file per repo, keyed by
   project.** `<storeRoot>/review-attestation/<projectId>/attestations.jsonl`,
   mirrors the existing `firewall-ledger.ts`/`audit-store.ts`
   append-only-log shape exactly (`appendFileSync`, `mkdirSync
   recursive`, one JSON object per line) — no new persistence pattern
   invented for this feature.
3. **Schema (closed, `.strict()`):**
   ```ts
   {
     diffHash: string;        // sha256 hex, Locked Decision 1
     baseRef: string;         // as typed by the caller, e.g. "origin/main"
     headRef: string;         // as typed by the caller, e.g. "HEAD"
     verdict: "approve" | "request-changes" | "needs-work";
     reviewerLabel: string;   // free text, e.g. "code-reviewer" or "critic" — NOT an identity proof, Non-Goal
     note?: string;           // optional free-text summary, redacted through @megasaver/policy's redact() before storage (Security & privacy)
     reviewPackId?: string;   // optional cross-reference to a review-packs packId, Locked Decision 5
     createdAt: string;       // RFC 3339
   }
   ```
   Every field except `note`/`reviewPackId` is required — a record
   missing `diffHash` or `verdict` is not a usable attestation.
4. **`mega review check <base>..<head> [--project <name>]`** computes
   the CURRENT diff hash for the given range the same way (Locked
   Decision 1), reads every attestation row for the project, and
   reports one of four states per matching-or-not attestation set:
   - `no-attestations` — nothing recorded for this project yet.
   - `current` — at least one attestation's `diffHash` matches the
     live diff hash right now → prints the verdict(s) and reviewer
     label(s), newest first.
   - `stale` — attestations exist for this project but NONE match the
     current diff hash (the code changed since any review) → prints
     the most recent attestation's verdict/hash/timestamp alongside
     the current hash, explicitly labeled `STALE — diff changed since
     this review`.
   - Both `current` and `stale` can co-occur if history has rows from
     different points in time; the report lists all matches for the
     live hash under `current` and the single most-recent non-matching
     row under `stale` context (never silently drops the stale history
     — an operator debugging "why did this merge with an out-of-date
     approval" needs exactly that row).
5. **Optional `--review-pack <packId>` cross-reference on `attest`.**
   Stored as `reviewPackId`, never validated against
   `@megasaver/review-pack` (no hard dependency, per Non-Goals) — if
   that package is not installed/available, the flag is still accepted
   and stored as an opaque string; `mega review check`'s output prints
   it verbatim when present, with no attempt to resolve or expand it.
6. **Free tier, no entitlement gate** — matches `mega guard`, `mega
   fail`, `mega trace explain` (all free); this is a process-discipline
   tool serving the repo's own mandatory review gate, not a Pro
   analytics surface.

## Architecture

```
mega review attest <base>..<head> --verdict <v> [--reviewer][--note][--review-pack]
  apps/cli/src/commands/review/attest.ts   runReviewAttest(input) -> computeDiffHash (git) -> redact(note) -> appendAttestation
mega review check <base>..<head> [--project]
  apps/cli/src/commands/review/check.ts    runReviewCheck(input) -> computeDiffHash (git) -> readAttestations -> classify(current|stale|no-attestations)

new leaf module: packages/core/src/review-attestation.ts
  reviewAttestationSchema, attestationLogPath, appendAttestation, readAttestations, computeDiffHash(execGit)
```

`computeDiffHash` lives in `@megasaver/core` (not a new leaf package —
unlike `review-packs`' Locked Decision 1 justification for a NEW
package, this feature is small enough — one schema, one append fn, one
read fn, one git shell-out — to sit directly in core alongside
`memory-anchor.ts`'s existing git-shelling precedent, avoiding a new
workspace package for ~150 lines of code; §8's "3 similar lines >
premature abstraction" cuts the other way here specifically because
`core` already owns the git-diff-hashing pattern this reuses). The two
CLI commands are thin adapters, following `apps/cli/src/commands/fail/`'s
existing multi-file subcommand-folder shape (`record.ts`/`list.ts`/
`show.ts`/`index.ts`) — `attest.ts`/`check.ts`/`index.ts` here.

## Components

1. **`reviewAttestationSchema`** (new, `packages/core/src/review-attestation.ts`)
   — the `.strict()` Zod schema from Locked Decision 3.
2. **`computeDiffHash(range: string, cwd: string, execGit?: ExecGit):
   string`** — runs `git diff --no-color <range>`, sha256-hexdigests
   the raw output. Reuses the exact `ExecGit` injection type
   `memory-anchor.ts` already defines (import it, do not redeclare an
   identical type) so tests inject a fake git without spawning a real
   process, matching that file's own test seam.
3. **`appendAttestation(storeRoot: string, projectId: string, record:
   ReviewAttestation): void`** — mirrors `appendFirewallEvent`'s
   exact shape (`mkdirSync` + `appendFileSync`, best-effort try/catch
   is NOT appropriate here unlike the firewall ledger — an attestation
   write failing silently would let a reviewer believe they successfully
   recorded approval when they did not; this write THROWS on failure,
   the CLI command surfaces it as a real error, exit 1).
4. **`readAttestations(storeRoot: string, projectId: string):
   ReviewAttestation[]`** — mirrors `readGuardEvents`'s per-line
   `safeParse`-skip-malformed read loop exactly.
5. **`runReviewAttest`/`runReviewCheck`** (CLI adapters) — store
   resolve → project lookup (reuse `projectNotFoundMessage`) → compute
   diff hash against `process.cwd()` (the repo the CLI is invoked
   from — NOT the registered project's `rootPath`, since a reviewer
   may be running from a worktree; Task-time note: confirm whether
   using `process.cwd()` vs the project's `rootPath` matters for the
   git range resolution — most likely `process.cwd()` is correct
   since `git diff` resolves refs relative to the invoking directory's
   repo, consistent with how `memory-anchor.ts`'s own `execGit` is
   always called with an explicit `cwd` parameter, never assumed) →
   `redact(note)` via `@megasaver/policy` before storing (Security) →
   `appendAttestation`/`readAttestations` + classify.

## Error handling

- `git diff` failing (bad ref, not a git repo, dirty index edge cases)
  surfaces as a real CLI error (exit 1, clear message naming the bad
  ref) — never a silently-empty hash that would make every attestation
  look identical (an empty-diff hash collision would be a false
  "current" match against an unrelated review).
- A malformed line in `attestations.jsonl` (crashed writer, manual
  edit) is skipped per-line on read (mirrors every other JSONL reader
  in this repo — `readGuardEvents`, `readReplayTraces`, etc.), never
  aborts the whole `check` command.
- `appendAttestation`'s write failure (disk full, permission denied)
  is NOT swallowed (Component 3) — this is the one deliberate
  departure from the firewall-ledger's best-effort convention, because
  a silently-failed attestation write is worse than a loud one for a
  feature whose entire purpose is producing a trustworthy record.

## Security & privacy

- `--note` free text is redacted via `@megasaver/policy`'s existing
  `redact()` (same function `output-filter` and the intent hook
  already use) before it ever reaches disk — a reviewer pasting a
  snippet containing a secret must not durably persist it.
- The diff hash itself reveals nothing about diff CONTENT (one-way
  hash) — an attestation record is safe to keep even after the
  underlying commits are rewritten/squashed away; it becomes
  unmatchable (correctly reported as `stale` or simply never matching
  again), not a leak.
- No network calls, no new trust boundary — local git + local
  filesystem only, same as every other core module.

## Testing

| Unit | Test |
|---|---|
| `computeDiffHash` | identical diff content → identical hash (determinism); a one-character diff change → a different hash; injected fake `execGit` proves no real git process is spawned in unit tests |
| `appendAttestation`/`readAttestations` | round-trip preserves every field; malformed line in the JSONL is skipped, not thrown; write failure propagates (NOT swallowed) — spy-asserted |
| `runReviewAttest` | valid verdict + range → one appended record with the correct diff hash; invalid `--verdict` value → usage error, exit 1, no record written; `--note` containing a secret-shaped string is redacted before the on-disk bytes are inspected in the test |
| `runReviewCheck` | no attestations for the project → `no-attestations`; a matching-hash attestation → `current` with the right verdict; a non-matching attestation (diff changed after approval, simulated via two different fixture diffs) → `stale`, printing both the stale record and the current hash; multiple attestations, one current one stale → both surfaced (Locked Decision 4's co-occurrence rule) |
| `--json` | both commands emit structured JSON on the error path too (repo convention) |

No timing-tight tests; git interactions are fully injected/faked in
unit tests (real-git integration coverage, if any, follows the
existing precedent for how `memory-anchor.ts`'s own real-git tests are
scoped — check that file's test suite for the exact "when do we spawn
real git vs a fake" boundary and mirror it).

## Risk & process

**MEDIUM.** New append-only local ledger (same class as
`firewall-ledger.ts`/`guard-state.ts`, both MEDIUM-risk precedents in
this repo), one new core module, two new thin CLI commands, no
existing file's behavior changed, no merge gate wired (Non-Goal).
Required reviewer: `code-reviewer`. Escalation trigger: if a future
iteration of this feature wants to wire `mega review check`'s exit
code into an ACTUAL merge gate (CI required check, git hook), that
follow-up must be re-scoped and likely re-classified HIGH (it would
become a control that can block shipping — a different risk class
than a report-only tool) per `docs/conventions/risk-modes.md`; this
spec explicitly does not do that. Regression evidence: no existing
command's file is modified by this spec (Architecture: two new files
+ one new core module only); full `pnpm verify` green.

## Dependencies / build order

Independent of the other four 2026-08-08 pairs (no shared files).
Soft, non-blocking relationship with the in-flight `review-packs`
(batch build 8): `--review-pack <packId>` (Locked Decision 5) is
accepted and stored whether or not `review-packs` has shipped yet —
can be implemented before, after, or without that pair ever landing.
