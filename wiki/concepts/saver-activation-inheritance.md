---
title: Saver Activation Inheritance
tags: [token-saver, hooks, worktrees, telemetry]
sources:
  - docs/superpowers/specs/2026-07-02-saver-activation-inheritance-design.md
  - wiki/log.md
status: active
created: 2026-07-02
updated: 2026-07-03
---

## Implementation (shipped on `feat/saver-activation-inheritance`, 2026-07-03)

TDD across S1–S10; `pnpm verify` green (46/46 tasks). New in
`@megasaver/context-gate`: `family-identity` (canonical-path key),
`git-family` (bounded common-dir resolver, no subprocess; separate-git-dir
converges; foreign worktree-admin rejected), `saver-store` (v1 records +
legacy normalize + activation lock), `resolve-saver-settings` (precedence
0–4), `saver-heartbeat` (256/30d/skew registry, feeds proxy status),
`activation-scope` (shared CLI/GUI/hook writer). `@megasaver/shared` adds
`RepositoryFamilyKey`. The saver hook resolves through the family precedence
and writes liveness heartbeats; `mega session saver workspace|default|resolve`
and the GUI toggle are repository-aware. Integration test proves a worktree
inherits its repo's enable and compresses (the 2026-07-02 live regression).

## Purpose

Fix the exact-cwd activation gap that left Claude worktrees uncompressed even
when the main repository was enabled (source: `wiki/log.md`, 2026-07-02
diagnosis).

## Resolution

Effective settings resolve in this order: exact workspace, Git common-dir
family, verified legacy main-root setting, explicit global default, disabled.
Fresh installs remain disabled. Compression events stay keyed to the actual
worktree/session.

Every valid saver-hook invocation updates minimal global and per-workspace
heartbeats, including passthrough. Status can therefore distinguish configured
hooks, observed invocation, and actual compression.

Source: `docs/superpowers/specs/2026-07-02-saver-activation-inheritance-design.md`.

## Related

- [[entities/gui]] — the repository-aware Saver toggle (workspace/default) that
  shares the `activation-scope` writer with the CLI and hook.
- [[entities/stats]] — the compression-event metrics the heartbeat separates from
  mere hook invocation (configured vs observed vs actually-compressed).

