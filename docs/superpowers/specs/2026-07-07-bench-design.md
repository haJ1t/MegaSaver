---
title: Pro module 7 — paired benchmark (mega bench)
date: 2026-07-07
status: approved
risk: HIGH
scope: a seventh Pro module — paired saver-on/off command runs with token/wall-time/outcome-parity report and a CI assert gate. Composes the EXISTING policy command gate + child capture + filterOutput; records NO events and writes NO store state (bench runs are synthetic and must not skew m1–m6 analytics). Optional --md report file behind the teardown exists-guard pattern.
base: main (a49ebf73)
reviewers: [code-reviewer, critic]
manual-confirmation: given (user approved design 2026-07-07 — exec-pipeline pair, exit+classified-signal parity, terminal/json/md surfaces, --assert in v1)
---

# Pro module 7 — paired benchmark (`mega bench`)

## Motivation

The one objection every compression product meets: "does it change what my
tools tell me?" `mega bench` answers with numbers from the user's own
machine: the same command, run raw and run through the saver pipeline —
tokens kept out of context, wall-time overhead, and an outcome-parity
verdict. Shareable report; `--assert` turns it into a CI regression gate
(source: wiki/syntheses/pro-differentiation-portfolio.md N1).

## Locked decisions (user-approved 2026-07-07)

1. **Run unit = command pair via the exec pipeline components** — NOT an
   agent-session replay (v2+). The benched command passes the SAME
   `evaluateCommand` policy allow-list gate as `mega output exec`; bench
   can never run anything exec couldn't.
2. **Bench records NOTHING.** No `TokenSaverEvent`s, no chunk sets, no
   store writes — synthetic runs must not inflate the savings analytics
   modules 1–6 read. Therefore bench does NOT call
   `runOutputExecCommand`; it composes the gate + spawn/capture +
   `filterOutput` (no persistence) directly.
3. **Parity = exit code AND classified signal.** Pass A/B exit codes must
   match AND the classified signal of both outputs must match. v1 signal
   (plan-time precision): the CONFIDENT `classifyOutput` category
   (`isConfidentClassification`; below the 0.5 floor → null/unknown) —
   exit codes carry the real pass/fail outcome (test tools exit non-zero
   on failure), the category guards tool-output identity. Parser-level
   count parity (e.g. identical vitest pass/fail counts) is a v2
   refinement, noted in Non-goals. If BOTH signals are unknown →
   exit-code-only parity with an explicit honesty note. If EITHER pass
   ended in a spawn failure or timeout (`exitCode === null`) → parity is
   NOT claimed (`ok = false`, "run did not complete" note). Broken parity
   is reported as possibly-nondeterministic, never hidden.
4. **Fixed order B (raw) then A (saver), disclosed.** The methodology
   section states the ordering and the warm-cache bias it may introduce.
   Single pair only (no N-repeat statistics in v1).
5. **Surfaces**: terminal table + `--json` (BenchReport) + optional
   `--md <file>` share card using teardown's exists-guard/`--force`
   pattern. Privacy: the benched COMMAND LINE is shown (the user chose
   it); tool OUTPUT CONTENT never appears — only byte/token counts, times,
   exit codes, and the classified summary labels.
6. **`--assert` in v1**: exit 1 when parity is broken (report still
   printed). Savings/overhead thresholds are NOT asserted in v1.

## Design

### 1. Pure engine — `packages/pro-analytics/src/bench.ts`

Types:

```
BenchPass = {
  kind: "raw" | "saver";
  exitCode: number | null;      // null = spawn/timeout failure
  wallMs: number;
  rawBytes: number;
  returnedBytes: number | null; // saver pass only
  savingRatio: number | null;   // saver pass only
  signal: string | null;        // classified outcome summary; null = unknown
};

BenchParity = {
  exitMatch: boolean;
  signalMatch: boolean | null;  // null when both signals unknown
  ok: boolean;                  // exitMatch && (signalMatch !== false)
  note: string | null;          // honesty notes (unknown signals, nondeterminism hint)
};

BenchReport = {
  command: string;              // rendered command line (user-chosen input)
  raw: BenchPass;
  saver: BenchPass;
  tokensRaw: number;            // tokensFromBytes(raw.rawBytes)
  tokensReturned: number;       // tokensFromBytes(saver.returnedBytes ?? saver.rawBytes)
  tokensSaved: number;
  dollarsSaved: number;         // same $3/MTok model, labeled (est.)
  overheadMs: number;           // saver.wallMs - raw.wallMs (may be negative)
  overheadPct: number;          // vs raw.wallMs; 0 when raw.wallMs === 0
  parity: BenchParity;
  savingsNote: string | null;   // review amendments: (a) when the saver pass
                                // returned MORE than raw, tokensSaved clamps
                                // to 0 AND this note says so; (b) when either
                                // pass is INCOMPLETE (exitCode null), savings
                                // are FORCED to 0 with "savings not measured"
                                // — a crashed saver pass would otherwise
                                // report maximal savings (critical catch).
                                // The incomplete parity note covers
                                // "spawn failure, timeout, or output cap";
                                // the methodology discloses the double run.
};
```

- **`composeBenchReport(command, raw, saver): BenchReport`** — pure math +
  parity: `exitMatch = raw.exitCode === saver.exitCode`;
  `signalMatch = raw.signal === null && saver.signal === null ? null :
  raw.signal === saver.signal`; `ok = exitMatch && signalMatch !== false`;
  notes: both-unknown → "outcome compared by exit code only (output not
  classifiable)"; `!ok` → "parity broken — the command may be
  nondeterministic; re-run to confirm". Zero-division guards on
  `overheadPct`.
- **`renderBenchMarkdown(report): string`** — fixed sections:
  `# Same command, twice — a Mega Saver bench`, `## The pair` (command
  line + ordering disclosure), `## Tokens` (raw vs returned vs saved,
  $ (est.)), `## Time` (both wallMs + overhead), `## Outcome parity`
  (verdict + signals + note), `## Methodology` ($3/MTok, ≈4 bytes/token,
  "measured, not modeled", B-then-A ordering + warm-cache disclosure,
  single-pair caveat). Output content never rendered — counts, times,
  exit codes, classifier labels, and the user's own command line only.
- Export both + types from `src/index.ts`.

### 2. Gated CLI — `apps/cli/src/commands/bench.ts` (top-level)

`runBench(input)` shape:

1. `checkEntitlement("savings-analytics", …)` FIRST; free →
   `BENCH_UPSELL` (reuses `PRO_ANALYTICS_URL`), exit 0, nothing gated
   behind it runs (spy-enforced across flag combos, including no policy
   evaluation and no spawn).
2. Policy gate: the command (from the `--`-style positionals, reusing the
   `execCommandFromPositionals` mechanics of `mega output exec`) must pass
   `evaluateCommand` with the same project permissions exec uses; denial →
   the same honest denied message + exit 1, NO spawn.
3. Passes via an injected `runPass: (opts) => Promise<{ exitCode, wallMs,
   output }>` whose default replicates exec's child-capture semantics
   (timeout default 300s, max-bytes 20MB cap — same constants); tests
   inject a fake spawner. Pass B first (raw: measure + classify only),
   then pass A (same capture, then `filterOutput` WITHOUT persistence,
   timed inside the pass; returnedBytes/savingRatio from the filter
   result).
4. Signals: both outputs run through the output-filter classification
   surface (the same classifier/parsers the pipeline uses —
   vitest/tsc/pytest/go/cargo/eslint); unclassifiable → null.
5. Render: terminal table (tokens / time / parity verdict), `--json` =
   `JSON.stringify(report)`, `--md <file>` = `renderBenchMarkdown` behind
   the exists-guard (`--force` to overwrite; guard checked before any
   write). `--assert` → `parity.ok === false` ⇒ exit 1 (after printing).
6. NO store writes anywhere: no events, no chunk sets, no saver records.
   Spy-enforced.

Flags: `--mode safe|balanced|aggressive` (the saver settings the A pass
filters with; default `balanced`; closed-enum validated via
`tokenSaverModeSchema` like `session saver enable`), `--md <file>`,
`--force`, `--assert`, `--json`, `--store <dir>` (the store is used ONLY
for the entitlement check and project permissions). No `--intent` flag
and no sessionId positional — bench never enters the ranking pipeline and
records nothing. Positionals after `--` = the command. Register `bench`
in `main.ts` (alphabetical). Reuse note: the child spawn/capture semantics
come from EXPORTING context-gate's existing `runChild` (currently private
in run-command.ts) rather than replicating its 90 lines of
timeout/max-bytes/kill-grace handling.

### 3. Docs + changeset

- `README.md`: command-table row + Pro section lines
  (`mega bench -- pnpm test`, `mega bench --assert --md bench.md -- pnpm
  test`) + bullet stating parity semantics and the no-recording rule.
- `.changeset/bench.md`: `@megasaver/cli` minor (→ 1.9.0).

## Security / risk (HIGH)

Spawns the user's command TWICE — strictly behind the existing
`evaluateCommand` allow-list (same policy surface as exec; no new
spawn powers) with exec's timeout/byte caps. No store mutation at all.
The critic must attack: gate ordering (entitlement → policy → spawn),
double-spawn side effects (a command with side effects runs twice — the
report's methodology must disclose this and the README must warn),
assert-flag exit semantics, and the no-recording invariant (no event/chunk
persistence on any path).

## Testing (TDD)

- **bench engine (pure)**: parity matrix (both match; exit differs; signal
  differs; both unknown → signalMatch null + note; one unknown one known →
  signalMatch false); overhead math incl. negative overhead and
  raw.wallMs=0; token/$ math; markdown fixed sections + ordering
  disclosure + "(est.)" + no-output-content check (hostile bytes in
  signal? signals come from the classifier — treat as labels, but the md
  renderer must still escape nothing beyond plain text: assert a crafted
  signal string with markdown metacharacters renders inside inline code).
- **CLI bench**: free path (each flag combo incl. --assert/--md) → upsell,
  spies: policy evaluator, spawner, filter, writeFile ALL uncalled;
  policy-denied command → denied message, exit 1, spawner uncalled;
  fake-spawner pair → report fields (order B then A pinned via call log),
  --json shape; --assert with parity-broken fake → exit 1, with parity-ok →
  exit 0; --md exists-guard + --force; NO-store-write spy (event recorder /
  chunk persist never invoked).
- `pnpm verify` green. E2E smoke: test key → activate → allow-listed
  trivial command (e.g. `node -e "console.log('ok')"` if allow-listed;
  otherwise the repo's permitted test command) → report renders, parity ok;
  `--assert` exit 0; denied command → policy message.

## Non-goals (deferred)

Agent-session benchmarking; N-repeat statistical runs; savings/overhead
threshold asserts; parser-count-level parity (identical vitest pass/fail
counts — v2); SVG card; recording bench history; GUI surface;
Windows-specific timing calibration.

## Slices

- **A**: pure engine (`composeBenchReport` + `renderBenchMarkdown`) — TDD.
- **B**: gated CLI (`runBench` + policy gate + injected spawner + flags)
  — TDD.
- **C**: register + README + changeset + verify + smoke + HIGH reviews.
