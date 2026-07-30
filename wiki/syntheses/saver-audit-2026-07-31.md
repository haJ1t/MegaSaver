---
title: Saver E2E Audit 2026-07-31 — findings, fixes, and what still gates 60-90%
tags: [saver, audit, token-savings, output-filter, context-gate, ledger]
sources:
  - docs/superpowers/plans/2026-07-31-saver-audit-fixes-plan.md
  - docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md (§9)
  - 24-agent workflow audit at e5a7a6f6 (7 scanners + adversarial verification)
status: active
created: 2026-07-31
updated: 2026-07-31
---

## What ran

User re-raised the 60-90% compression ask. A 24-agent end-to-end scan of the
saver architecture (hook path, context-gate, output-filter, delivery, stats,
instrument, churn mechanism, spec-§7 ledger) produced 63 raw findings; every
P0/P1 was adversarially verified (14 confirmed → 9 distinct defects, 2
refuted). All 9 fixed red→green on `worktree-feat-saver-audit-fixes`, plus
three follow-ups. Spec §9 carries the full correction list.

## Headline defect

**Foreground Bash could never compress in safe mode**: floor was
`budget + 1` = 32 001, above the ~30 000-char truncation ceiling — a botched
3732a0cb restore of a formula whose premise (pre-A4 fit-to-budget) had died
with `targetBudget`. Now `min(budget, 24 000)`; a 25 KB safe-mode Bash output
compresses end-to-end.

## Fixed in this round

Grep/Glob rebuild delivers omission marker + recovery handle with honest
`numFiles`; stderr boundary structural, never a droppable line (per-stream
events); ALL compressor markers non-droppable (shared `EVIDENCE_MARKER`);
dedupe gated to compressed band + folds counted + keeps highest-scored;
outline counts its summary (M13); go-test reports omissions; overlay events
idempotent (B11 double count → ~0.3% bucket-edge residue); unchanged re-read
ledgered envelope-true; daemon `/expand` charges expansion debt; savings
surfaces (headline/GUI/CLI) show signed NET with gross−refetched breakdown.

## Refuted during execution (do not re-open)

- pytest/cargo-test/eslint/stacktrace parsers do NOT share go-test's
  silent-omission defect — all four are complete partitions (byte-for-byte
  reconstruction verified). `parsers/index.ts` pins `dropped: 0`.
- "DEFAULT_MODE=safe makes the shipped saver inert": `safe` lives only in
  `disabled()` results; the operative enabled default is **balanced**
  (activation write paths). Safe-mode statements describe `--mode safe`.

## What still gates the 60-90% goal

Capability is measured (76-98% on eligible inputs, spec §7 ladder). The gate
is the A4 leg: **billed S > 0 and R < R\* = 66.7%** (churn mechanism
retracted 888d45cb; R = 2.4% measured; S = 1.199x modelled). One completed
two-arm real-API replay closes it; then the floor/mode adoption decision
(2048 floor, enable-default mode) is takeable. This round repaired the meter
that measurement will read (double count, uncounted re-reads, outline bytes,
expansion debt) — re-run the R recompute and offline S model after merge.

## Still open

Read/exec MCP delivery guard; `runOverlayOutputPipeline` wire-or-delete;
persisted signed ratio; unchanged-marker struct self-metrics (mcp-bridge);
fabrication coverage beyond hook path; §7 items 13/14 (uncommitted corpora);
CLI /excerpt nonce to close the bucket-edge race; F30 filenames byte-parity
in `record-output.ts`.
