---
feature: pipeline-audition
date: 2026-08-11
risk: LOW
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "9 of 9 (wave-3 batch)"
---

# Pipeline Audition — `npx megasaver audition` (P2-4)

## Problem

A new team evaluates Mega Saver without committing to hooks/daemon. `mega roi` needs history; `mega hotspots` needs an index. There is no **cold proof**: run three fixture tasks in a sandbox, measure what the saver would have compressed vs. what it actually cost, and print an honest, counters-only verdict. Wave-2 backlog deferred `pipeline-audition` as "`npx megasaver audition proof-before-install loop`" (`wiki/syntheses/next-wave-2-ideas-2026-08-06.md:79`). It is the top-of-funnel counterpart to `one-command-up` (`docs/superpowers/specs/2026-08-06-one-command-up-design.md`).

## Goal

1. `npx megasaver audition` (also `mega audition`) runs **three sandboxed fixture tasks** (read-heavy, grep-heavy, build-heavy) inside a temp dir, with the output-filter pipeline and the context gate in-process — no hooks installed, no daemon, no store mutation on the real repo.
2. Emits an **audition report**: `audition.json` (Zod strict) + human text — per-task bytes in, bytes delivered, chunks, `childExitCode`, estimated tokens (bytes/4 + `estimateTokens` double-counted), and an honest verdict `audition would have saved ~X% on this fixture — not a bill claim`.
3. `audition --json` is machine-readable for `mega up` (P1 of `one-command-up`) to show "before" vs "after" on real install.

Success criteria: clean checkout → `npx megasaver audition` finishes < 30s, prints three fixture rows, writes `audition.json` to temp dir, does not write to `~/.megasaver/store` (sandbox store only); `pnpm verify` green.

## Non-Goals (YAGNI)

- No real LLM calls, no proxy, no billing — counters only, honest-metrics.
- No hook install/uninstall — audition is side-effect free on the real repo (sandbox only).
- No fixture authoring UI — three baked-in fixtures, versioned.
- No GUI in v1 (CLI only; GUI may later embed the same report).

## Locked Decisions

1. **Fixture tasks are baked-in, not user-supplied.** Three tasks, each a shell script + fixture repo slice checked into `apps/cli/fixtures/audition/{read,grep,build}/`: (a) read 3 files + summarize, (b) grep for a symbol across `src/`, (c) failing `pnpm test` + excerpt. Each task's raw output is known size, so "delivered vs stored" is measured, not counterfactual.
2. **In-process pipeline, not hook replay.** Audition calls `runOutputPipeline` (`packages/context-gate/src/run.ts`) + `filterOutput` (`packages/output-filter/src/index.ts`) directly, not via hooks — no need for a fake Claude session. This mirrors `audit-overlay-fallback` (`docs/superpowers/specs/2026-07-03-audit-overlay-fallback-design.md`) self-grade posture: measure what the filter actually produced.
3. **Sandbox store, not the real one.** Audition uses `mkdtempSync(tmpdir(), "audition-")` as `storeRoot`; nothing is written to the user's real `~/.megasaver`. Temp dir is removed on success (unless `--keep`). Isolation is proven by asserting the real store's `listChunkSets` count unchanged after audition.
4. **Honest metrics, no bill claim.** Report fields are `rawBytes`, `deliveredBytes`, `storedBytes`, `chunks`, `childExitCode`, `estimatedTokensRaw = ceil(bytes/4)`, `estimatedTokensDelivered` similarly, `savingsRatio = 1 - delivered/raw` — no dollar figure. Verdict line is fixed: `"On this fixture, delivery was X% smaller than raw. This is a byte counter, not a bill claim."` (mirrors `wiki/syntheses/rtk-competitive-analysis-2026-08-01.md:85` per-filter honesty).
5. **Ownership.** `apps/cli` owns all: `apps/cli/src/audition/{fixtures,run,report}.ts` + `commands/audition/index.ts`. No new package; fixtures are static files under `apps/cli/fixtures/`.

## Architecture

```
npx megasaver audition [--keep] [--json]
  sandbox = mkdtemp real store
  for each fixture in [read,grep,build]:
    run fixture script (execFile, 10s timeout) -> rawOutput
    runOutputPipeline(rawOutput, budget) -> {delivered, chunks, chunkSetId}
    record bytes + exitCode
  build AuditionReport (Zod strict, version 1)
  renderAuditionReport(report) -> text (default) | --json
  write audition.json to sandbox (and to ./audition.json if --keep)
  rm sandbox (unless --keep)
```

## Components

- **C1 `apps/cli/fixtures/audition/`:** three fixture dirs + `manifest.json` (version, tasks).
- **C2 `apps/cli/src/audition/run.ts` (pure-ish):** `runAuditionFixture`, `runAllAuditions`.
- **C3 `apps/cli/src/audition/report.ts` (pure):** `auditionReportSchema`, `buildAuditionReport`, `renderAuditionReport`.
- **C4 `apps/cli/src/commands/audition/index.ts`:** citty `mega audition`; also wired as `bin/megasaver` `audition` subcommand for `npx megasaver audition`.

## Error handling

- Fixture script timeout/error → that task row shows `exitCode` + `error: timeout` and `deliveredBytes = rawBytes` (no saving claim).
- No git / no fixtures missing → `error: fixture "<name>" missing` exit 1 (fail-closed; sandboxed, not red).
- Real store mutated check: after audition, `listChunkSets` on real store unchanged — if changed, report `stale` warning and exit 1 (integrity guard).

## Security & privacy

- Fixture scripts are checked-in, not user-supplied; no arbitrary command execution beyond the three scripts.
- All `execFile` calls use argv arrays, timeout 10s, sandboxed store + sandboxed fixture copy (never cwd).
- No secrets, no network.

## Testing

- **Unit (TDD):** `buildAuditionReport` counters sum, `renderAuditionReport` contains three rows + honest disclaimer line, `runAuditionFixture` on a fake rawOutput returns `delivered < raw`, sandbox isolation (real store count unchanged after audition), `--json` parses.
- **Integration:** `runAudition` on real fixtures finishes < 30s, writes `audition.json` that validates, `--keep` leaves sandbox dir with report.

## Risk & process

**LOW** (§12: CLI-only, sandboxed, no user-file mutation, no hook). Abbreviated chain allowed; `code-reviewer` only.

## Dependencies / build order

- Depends on: `packages/context-gate` `runOutputPipeline`, `packages/output-filter` `filterOutput`, `estimateTokens`.
- Independent of P0/P1, but best demoed after `one-command-up` lands (audition = before, up = after).
- Build order **9 of 9 (wave-3 batch)** — last, isolated.

## Open questions

1. Should audition also run a fourth "no-op" task that measures baseline proxy overhead (0%) as a control? (v1: no.)
