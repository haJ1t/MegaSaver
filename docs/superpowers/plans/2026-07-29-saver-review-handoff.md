# Saver Programme — Review Handoff

- **Date:** 2026-07-29
- **Branch under review:** `docs/saver-integrity-spec` (41 commits ahead of `main`)
- **Spec:** `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md` §7
- **Risk:** CRITICAL — `risk-modes.md` requires `code-reviewer` **and** `critic`
  in separate contexts, plus `security-reviewer`. Author must not review.

## State

`pnpm verify` green: 60/60 turbo tasks (lint, typecheck, all package tests,
conventions). Three tracks merged with no source conflicts; the single conflict
was an append-only wiki log, resolved by keeping both sides.

Setup in a fresh worktree — a worktree carries no `node_modules` or `dist/`:

```sh
corepack enable pnpm --install-directory "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
pnpm install --prefer-offline && pnpm build   # build is REQUIRED
```

## Review assignment (author ≠ reviewer, by capability)

| area | author | reviewer |
|---|---|---|
| Track A — architecture (A1–A4) | Opus 5 | **fresh Opus 5 context** + `critic` separately |
| Track B — accounting (B1–B10) | Kimi K3 | Opus 5 |
| Track C — defects (C1–C5) | Flash 3.6 | Kimi (C1/C4/C5), Opus (C2/C3) |
| whole branch — secrets/disk | — | `security-reviewer` |

`security-reviewer` matters here specifically: A2 changed **what is written to
disk** (full redacted raw on three more paths) and B1 changed **what is reported
to the user**.

## Where to look hardest

These are the places the author is least able to see:

1. **`recoverableChunks` redacts, then chunks.** Every path now persists the full
   raw output where three of them previously persisted only kept excerpts — a
   large increase in stored bytes. Confirm redaction cannot be bypassed on any
   path, and that retention/GC still bounds the new volume.
2. **Line provenance in `normalize.ts`.** `collapseRepeatedLinesTraced` /
   `collapseSimilarTraced` claim every surviving line maps to a contiguous raw
   span. If a span is wrong, gap markers name the wrong lines — the exact class
   of defect A3 exists to remove, reintroduced silently.
3. **`targetBudget` in `fit.ts`.** Ratios are a policy dial with no measurement
   behind them (stated in the comment). Check the interaction with the no-blind
   fallback: a small target on a small input must not yield summary-only output.
4. **The `maxReturnedBytes` removal in `record-output.ts`.** Passing a redundant
   default silently suppressed the target ratio. Look for the same pattern
   elsewhere — a field that means "the caller chose" being filled with a default.
5. **Evidence-marker reservation in `fitBudget`.** Marker-bearing chunks are
   reserved ahead of score. Many markers could crowd out real content; each
   still yields to the budget, but the ordering is worth an adversarial read.

## Known-open, deliberately

Not oversights — each has a recorded reason in the spec §7 "Deferred":

- Admission-guard minimum-saving floors ship **OFF** (cost axis belongs to the
  net-positive spec; any floor >~1 KB re-opens the dead band PR #278 closed).
- Exec-path **enforcement** absent; those paths now measure honestly and report
  a signed delta so inflation is visible first.
- W6 condensation unstarted.

## The gate that is NOT met

§W1's pass condition is **net cost reduction at constant integrity**. Integrity
holds (9/9) and the ratio is measured, but **net cost is unmeasured** — it needs
a real-API benchmark, and `wiki/syntheses/saver-cache-churn` records that the
existing harness could not resolve an effect of this size. B5 added fresh-store
hygiene; the harness has still never run against the real API.

**No net-cost or "saves X%" claim may be published until it does.** The ratio
table in §7 is a diagnostic, not a savings claim.

## Suggested order

1. `security-reviewer` on the whole branch (it changes disk writes and reporting).
2. Per-track `code-reviewer` passes.
3. `critic` adversarially on Track A only — it carries the CRITICAL risk.
4. Only then the real-API benchmark, so it measures the reviewed shape.
