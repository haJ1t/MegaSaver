---
title: Intent-Aware Hook
tags: [concept, hooks, ranking, intent, claude-code, phase-6b]
sources: [docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md, docs/superpowers/plans/2026-06-25-intent-aware-hook.md]
status: active
created: 2026-06-26
updated: 2026-06-26
---

## Problem

Native tool output captured by the PostToolUse saver hook (`Read`, `Bash`,
`WebFetch`, …) was compressed and ranked with **no intent**: `buildSaverDecision`
called `record(...)` without `intent`, so `filterOutput → scoreChunk` ranked with
an empty/generic intent (spec: docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md). Proxy tools already carry an explicit validated
intent, so only the hook path was generic — the known Phase 6 gap.

## Mechanism

A new `UserPromptSubmit` Claude Code hook, `mega hooks intent`, captures the
user's latest prompt and writes it to
`<storeRoot>/stats/<workspaceKey>/session-intent.json` — atomic (tmp + rename),
latest-wins, SECRET-REDACTED via `@megasaver/policy` (code: apps/cli/src/hooks/intent-run.ts). The PostToolUse saver hook
(`buildSaverDecision`) reads it via `readSessionIntent` and threads it as the
ranking intent into `recordAndFilterOverlayOutput → filterOutput → scoreChunk`
(see [[context-gate]], [[context-pruning-engine]]).

## Fill-gap precedence

Session intent is used **only when no explicit intent is present** (PR #180).
Tool-explicit intent always wins — proxy tools keep their own intent untouched.
This scopes the change to exactly the generic gap and keeps risk MEDIUM; the
ranking algorithm (`scoreChunk` weights) is unchanged — intent is an input only.

## Transport

A single workspace-keyed file in `storeRoot`, no new daemon route. Both the
daemon path (the `/excerpt` schema gained an optional `intent`) and the
in-process path read the same file. `workspaceKey` parity across hook + saver via
shared `encodeWorkspaceKey(cwd)` (spec: docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md). Non-goals: no per-call intent history,
no TTL/staleness, no merge mode — every new prompt overwrites.

## Install (connector)

[[connectors-claude-code]] install/uninstall/status now manage the
`UserPromptSubmit` hook alongside the existing pre/post hooks. `status` gained
`intentInstalled`; `connected = pre && post && intent` (PR #180). Packages:
[[cli]], [[context-gate]], `@megasaver/daemon`, `@megasaver/connector-claude-code`.
