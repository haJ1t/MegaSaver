---
title: Saver Activation Inheritance
tags: [token-saver, hooks, worktrees, telemetry]
sources:
  - docs/superpowers/specs/2026-07-02-saver-activation-inheritance-design.md
  - wiki/log.md
status: proposed
created: 2026-07-02
updated: 2026-07-02
---

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

