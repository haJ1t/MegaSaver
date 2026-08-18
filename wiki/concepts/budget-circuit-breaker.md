---
title: Budget Circuit Breaker
category: concept
tags:
  - budget
  - circuit-breaker
  - tokens
  - spend
  - receipts
  - wave-2
updated: 2026-08-18
---

# Budget Circuit Breaker (`mega budget`)

> **Quick summary:** Per-session and per-task token limits with non-blocking 80%/100% warnings and 3x-median variance alarms. Governed by measured overlay receipts, fail-open semantics, and synchronous hook evaluation via `PostToolUse additionalContext`.

---

## 1. Non-Negotiable Architectural Principles

1. **Warn-Only & Fail-Open:** The hook never denies or interrupts agent execution. In case of corruption or unreadable state, the circuit breaker defaults to fail-open (silent passthrough).
2. **Zero Awaited I/O on Hot Path:** The pre-stdout check in the saver hook is a synchronous read of a single tiny JSON state file (`stats/<wk>/budget/state-<sid>.json`). The state refresh is deferred post-stdout.
3. **Receipts Only (No Estimation):** Token burn is computed strictly over measured `returnedTokens` fields in overlay events. Unmeasured events are tracked separately in coverage counters (`M/N events measured`), never estimated from bytes.
4. **Precedence Hierarchy:** Explicit session limit (`budgets.sessions[sid]`) $\rightarrow$ Task label limit (`budgets.tasks[label]`) $\rightarrow$ Workspace default limit (`budgets.sessionDefault`).

---

## 2. Thresholds & Variance Alarms

- **80% Warning (`BUDGET_WARN_RATIO = 0.8`):** Emitted once per session when measured token burn reaches $\ge 80\%$ of effective limit.
- **100% Exceeded Warning:** Emitted once per session when burn reaches $\ge 100\%$ of limit.
- **Variance Alarm (`BUDGET_VARIANCE_MULTIPLE = 3`):** Emitted when a labeled session's burn reaches $\ge 3\times$ the median burn of $\ge 3$ sibling sessions sharing the same task label (`BUDGET_VARIANCE_MIN_SAMPLES = 3`).

---

## 3. Storage Layout & CLI

- **Configuration:** `stats/<workspaceKey>/budget/budgets.json` (managed via `mega budget set`, `mega budget clear`).
- **Session Check State:** `stats/<workspaceKey>/budget/state-<liveSessionId>.json` (mode `0600`, directory `0700`).
- **Commands:**
  - `mega budget set <tokens> [--task <label>] [--session <id>]`
  - `mega budget status [--session <id>] [--json]`
  - `mega budget clear [--json]`
