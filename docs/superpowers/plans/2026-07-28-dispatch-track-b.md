# Track B — Task Packet (Kimi K3)

**Worktree:** `/Users/ozger/Desktop/MegaSaver-saver-b-accounting`
**Branch:** `feat/saver-b-accounting` (from `docs/saver-integrity-spec`)
**Risk:** HIGH. **Spec:** `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md`

## Worktree setup — run this FIRST, before any test

A git worktree shares `.git` but NOT `node_modules` or `dist/`, so a fresh one
cannot resolve a single workspace import. `turbo` also shells out to a `pnpm`
binary and fails with "Unable to find package manager binary" unless one is on
PATH. `pnpm` is not on PATH here, but corepack provides it.

```sh
corepack enable pnpm --install-directory "$HOME/.local/bin"   # once per machine
export PATH="$HOME/.local/bin:$PATH"                          # once per shell
cd <your worktree>
pnpm install --prefer-offline
pnpm build            # REQUIRED - vitest resolves @megasaver/* from dist/
```

Skipping `pnpm build` produces `Failed to resolve entry for package
"@megasaver/policy"`, which looks like a broken import and is not. After this,
`pnpm verify` and `pnpm vitest run` work as written.

## Why this track exists

Today the saver **cannot see itself failing**. `bytesSaved = Math.max(0, …)`
(`output-filter/src/types.ts:351`) plus `nonnegative()` schemas
(`stats/event.ts:20,43`, `summary.ts:10,27`) make an inflating event record as
"0 saved". Inflation is structurally invisible in every aggregate, so every
average is biased positive.

That is why **B1 gates Track A's final stage**. Until signed savings lands, no
ratio or cost measurement anyone runs means anything. B1 is the single most
load-bearing item in the whole programme — do it first.

## Rules

1. **TDD.** Failing test first, always.
2. **You own exactly these files. Do not edit any other source file:**
   ```
   packages/stats/src/event.ts
   packages/stats/src/summary.ts
   packages/stats/src/audit-store.ts
   packages/context-gate/src/fetch-chunk.ts
   packages/mcp-bridge/src/server.ts
   packages/output-filter/src/tokens.ts
   packages/output-filter/src/compress/tsc.ts
   packages/output-filter/src/classify.ts
   packages/output-filter/src/parsers/go-test.ts
   packages/output-filter/src/compress/prose.ts
   packages/output-filter/src/compress/json.ts
   packages/bench-replay/**
   + NEW packages/output-filter/src/model-facing-bytes.ts
   ```
   `types.ts`, `fit.ts`, `normalize.ts`, `record-output.ts`, `read.ts`,
   `run-command.ts` are **Track A's**. You create and export
   `model-facing-bytes.ts`; **Track A wires it in.** That split exists specifically
   so `types.ts` stays single-owner — do not shortcut it.
3. Tests (after the setup above): `cd packages/<pkg> && pnpm vitest run`.
   Conventions: `node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/conventions-sync/index.ts --check`
4. Baseline green: stats 249, mcp-bridge 343 (+1 skipped), output-filter 451,
   bench-replay 149, context-gate 369. Any failure is yours.
5. **B6 and B8 are blocked** until Track A publishes its integrity contract
   (test interface, arriving as a red property test). Do B1–B5 first; A will
   hand you the contract.

---

## B1 — Signed savings **(do this first; it unblocks Track A)**

**Files:** `stats/src/event.ts`, `stats/src/summary.ts`

Add a signed `deltaBytes` so inflation is representable. Keep `bytesSaved` as a
clamped legacy field for one minor version — aggregates read the signed field.

**Specify the migration shape before writing code.** This crosses every reader of
those schemas. Decide and write down, in the PR body: whether `deltaBytes` is
required or optional on read, how a pre-existing event without it is interpreted,
and whether summaries are rebuilt or carried forward. Do not discover this
mid-implementation.

Sign convention: `deltaBytes = rawBytes - returnedBytes`. Positive = saved,
**negative = inflated**. Do not clamp it anywhere.

**Gate — this is the acceptance test for the whole track:**
a deliberately inflating input produces a **negative** aggregate in `mega audit`.
If inflation still reports 0, B1 is not done and Track A's A4 cannot start.

---

## B2 — Model-facing byte module

**New file:** `packages/output-filter/src/model-facing-bytes.ts`, exported from
the package index.

`filterOutput`'s own `returnedBytes`/`savingRatio` (`types.ts:346-352`) count
summary + excerpt text only. They exclude the `… [lines X-Y omitted]` gap markers
and the recovery footer that the model actually receives. `record-output.ts:226`
recomputes honestly; `read.ts:188`, `run-command.ts:256`, `run-command.ts:527`
and `apps/cli/src/commands/bench.ts:184` publish the inflated number.

Export one function computing **bytes the model receives** = summary + excerpts +
gap markers + footer.

**It must also account for the MCP envelope.** `mcp-bridge/src/server.ts:316`
does `JSON.stringify(payload)`, so per-excerpt `score` and the 9-field `features`
object are delivered to the model and counted nowhere today.

You export it. Track A wires it into `types.ts` and `record-output.ts`.

---

## B3 — Recovery debt

**File:** `packages/context-gate/src/fetch-chunk.ts` (46 LOC, emits nothing today)

The footer promises "Full output recoverable — `mega output chunk …`", but a
chunk fetch records no event. The ledger banks gross savings at compression time
and never debits expansion, so the UI shows a saving the agent has already paid
back.

Append an expansion event carrying fetched bytes + `chunkSetId`. Net saving per
chunk-set = compression saving − Σ expansions. Reports show net.

---

## B4 — Real tokenizer at the reporting boundary

**File:** `packages/output-filter/src/tokens.ts:17-19`

`estimateTokens = ceil(bytes/4)` underpins every threshold, every reported saving
and every dollar figure. Use a real BPE count for **reported** numbers; keep the
cheap estimate for hot-path gating (it runs on every tool call).

**Measure and publish the divergence** — report the ratio for code, prose, JSON
and Turkish text. Track A's strengthened admission guard derives its threshold
from your numbers; it currently ships a `TODO(threshold)` placeholder waiting on
this.

---

## B5 — Field telemetry + harness hygiene

There is **no field telemetry at all**. `~/.claude/settings.json` carries no
MegaSaver hook, and `~/.local/share/megasaver` has no `stats/`, `content/` or
`evidence/`. Every number in the wiki comes from a benchmark harness that
`wiki/syntheses/saver-cache-churn` itself says cannot validate a stage.

Install the hook, capture one real session, report what the store actually
contains afterwards.

Fresh store per benchmark run. **Justify it by workspace-scoped net-effect and
stats records — not by the seen-ledger carry-over story.** That story is in the
wiki but `saver-seen.ts:20` is session-scoped (`saver-seen/<sessionId>.json`) and
`bench-replay/src/saver-subprocess.ts:106,114` takes the session id from its
caller, with no in-repo caller found. Treat it as unverified.

---

## B6 — `compressTsc` silent drop **(blocked on Track A's contract)**

**File:** `packages/output-filter/src/compress/tsc.ts:16-34`

Every line not matching `file(line,col): error TSxxxx` is deleted, except
`Found N errors`. Casualties: position-less diagnostics
(`error TS5023: Unknown compiler option`), multi-line error explanations, and
code frames — often the most actionable lines.

Either satisfy Track A's integrity contract, or emit an explicit marker naming
what was removed and how to recover it. Silent deletion is not acceptable.

## B7 — Classifier over-reach

**File:** `packages/output-filter/src/classify.ts:127-129`

`typescript` is assigned at 0.7 confidence on an output sniff alone, so **any**
text containing `error TS1234:` — including a fetched GitHub issue page — is
routed into B6's compressor.

## B8 — `parseGoTest` panic drop **(blocked on Track A's contract)**

**File:** `packages/output-filter/src/parsers/go-test.ts:15-30`

Only blocks containing `--- FAIL:` are kept. A panicking test never prints that
line, so its panic message and stack are dropped silently whenever any other
block survives.

## B9 — `compressProse` / `compressJson`

`compress/prose.ts:6-10` keeps the first paragraph per section + the first 3 list
items. `compress/json.ts:10,68-81` keeps first 3 + last of any array ≥20 and does
not preserve intent-matched values.

The prose behaviour is `wiki/syntheses/saver-savings-gaps` **D20, a conscious
accept** — it is re-opened **only** because the new integrity contract demands an
explicit marker or recoverability, not because the trade-off was wrong. Do not
treat it as a bug to eliminate; treat it as a promise to make honest.

## B10 — Daemon-timeout double count

**Files:** `apps/cli/src/hooks/saver-run.ts:108-138` (read-only for you — report
if the fix must live there), `packages/daemon/src/handlers.ts:47`

`excerptHandler` calls `recordAndFilterOverlayOutput`, which appends the overlay
event. A **client-side timeout after the daemon already wrote** makes the hook
fall back to in-process and append the event a second time. Savings are
double-counted.

`saver-run.ts` is outside your file list. Diagnose it, and if the correct fix
belongs there, **report rather than edit**.

---

## Definition of done

- One commit per item, conventional format, subject ≤50 chars, imperative.
- B1's gate demonstrated with captured output, not asserted.
- B4's divergence numbers published — Track A is blocked on them.
- Owned packages green: `stats`, `mcp-bridge`, `output-filter`, `context-gate`,
  `bench-replay`.
- Review: `code-reviewer` by Opus 5; **`security-reviewer` on B1** — it changes
  what is reported to the user.
- Do **not** merge to `main` yourself. Push the branch and report.
