---
title: Hot Handoff (i10) — live task packet across agents
tags: [feature, cli, core, connectors, stats, pro, i10, memory-moat]
sources:
  - docs/superpowers/specs/2026-07-18-hot-handoff-design.md
  - docs/superpowers/plans/2026-07-18-hot-handoff-plan.md
status: active
created: 2026-07-19
updated: 2026-07-19
---

Carries the *live* working task between agents mid-session: a redacted,
bounded, expiring `.megahandoff` packet a sender packs and a receiver applies
as a HANDOFF block in its config file. i10 in
[[syntheses/memory-moat-portfolio]] (≈ N10 post-2.0). Branch
`worktree-feat-hot-handoff`, verify green, pending merge.

## Surface ([[entities/cli]])

- `mega handoff pack --to <target>` — writes the packet (Pro; `--dry-run` free).
- `mega handoff open <file> [--merge]` — applies the block, optionally merges
  memories as suggested entries (Pro; creates the target file if absent).
- `mega handoff inspect <file>` — recomputes redaction/secret-path scans from
  the payload instead of trusting manifest claims (free).
- `mega handoff clear` — removes the block (free, ungated).

Subcommands-only: citty 0.1.6 cannot mix a root `run` + required `--to` +
`subCommands` (spec Status note).

## Packet format ([[entities/core]] `bundle-frame.ts` + `handoff-packet.ts`)

Reuses the `.megabrain` bundle frame ([[entities/brain-portability]]):
two-line NDJSON, manifest + `payloadSha256`-hashed payload. `kind
"megahandoff"`. Payload carries budgeted resume brief, recallable memories,
unresolved failures, and a secret-path-filtered dirty diff.

## Security posture (HIGH)

Redaction-first at pack (`@megasaver/policy` firewall, findings counted);
`evaluatePathRead` secret-path exclusion incl. `changedFiles`; open-side
re-redaction; agent-slug + sentinel guards block `\n`/ANSI/Trojan-Source
forgery into terminal reports and the target file; expiry fails closed.

## Reuse (no new store)

Block writes via [[entities/connectors-shared]] `handoff-block.ts`
(sentinel upsert); brief from Warm Start; advisory `HandoffEvent` stats
stream ([[entities/stats]]); `hot-handoff` ProFeature key in
`@megasaver/entitlement` (dry-run/inspect/clear free); redaction/path-eval
firewall from [[entities/policy]].
