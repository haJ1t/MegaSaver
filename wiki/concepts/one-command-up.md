---
title: One-Command Up
category: concept
tags:
  - activation
  - onboarding
  - up
  - down
updated: 2026-08-18
---

# One-Command Up (`mega up` / `mega down`)

> **Quick summary:** `mega up` collapses full workspace activation into a single idempotent transaction (**DETECT $\rightarrow$ PLAN $\rightarrow$ APPLY $\rightarrow$ VERIFY**). It prints a drift report before making any changes, records prior state in an atomic manifest (`up/<workspaceKey>/manifest.json`), and `mega down` precisely reverses recorded changes without touching unmanaged settings.

---

## 1. The Activation Funnel

Before `mega up`, setting up an agent involved multiple commands (`mega hooks install`, `mega connector sync`, `mega session saver workspace enable`, `mega daemon`, `mega gui`). `mega up` unifies them into a single command:
1. **DETECT:** Inspects existing `~/.claude/settings.json`, connector target files (`CLAUDE.md`), and workspace token saver records.
2. **PLAN:** Computes pure diffs (`install`, `repair`, `ok`, `conflict`). Stops on `--plan`, prompt decline, or non-TTY without `--yes`.
3. **APPLY:** Atomically applies changes and writes `up/<workspaceKey>/manifest.json` under file lock.
4. **VERIFY:** Performs active heartbeat self-test for the saver hook. Passive hooks are honestly reported as *"installed, not yet observed"*.

---

## 2. Reversal Contract (`mega down`)

`mega down` reads `up/<workspaceKey>/manifest.json` and reverses recorded steps in LIFO order:
- **Saver:** Restores recorded prior state (`priorEnabled`, `priorMode`, `exact`).
- **Connector Block:** If prior was `missing` and file is now empty after removing the sentinel block, deletes the file; if prior was `no-block`, strips only the sentinel block; if prior was `block`, leaves file intact.
- **Hooks:** Uninstalls hooks only if `priorConnected === false`.
- **Store Data:** Registry project creation is permanent store data and is never deleted.
