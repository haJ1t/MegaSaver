---
title: Mega Saver ships its own agent (mission inversion)
tags: [mission, governance, mega-agent, critical]
sources: [docs/conventions/mission.md, docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md]
status: active
created: 2026-08-19
updated: 2026-08-19
---

## Decision

Mega Saver ships a first-party coding harness, [[mega-agent]]
(`crates/mega-agent`, Rust). Operator-confirmed 2026-08-19 as §13 item 6 of the
harness spec — the last of seven CRITICAL confirmations.

## Why this needed a decision at all

`docs/conventions/mission.md` read: "Agents connect to Mega Saver, never the
reverse." Shipping our own agent inverts that sentence, so this is a
product-identity change, not a doc edit.

## What survived and what changed

**Survived — the enforceable half.** Core stays agent-agnostic. `mega-agent`
reaches Core through the daemon on the same routes as any third-party
connector: no privileged path, no short-cut into Core internals, and nothing in
Core knows the harness exists (spec §15).

**Changed — the identity half.** `mission.md` gained a "First-party agent"
section carrying one non-obvious constraint: **the harness ships only while the
two-arm eval shows a positive delta.** If a bare agent loop scores the same as
the same model driven through the harness, the harness is what gets cut — not
the measurement. That clause is what keeps "we ship an agent now" from becoming
unfalsifiable.

## Mechanics

`docs/conventions/mission.md` is the source; `pnpm conventions:sync --write`
regenerated `CLAUDE.md` §1, `AGENTS.md`, and `.cursor/rules/mega-context.mdc`.
Bare `pnpm conventions:sync` runs in **check** mode and exits 1 on drift —
`--write` is the regenerating form (`scripts/conventions-sync/src/cli.ts:22`).

Related: [[conductor-is-a-role]], [[mega-agent]].
