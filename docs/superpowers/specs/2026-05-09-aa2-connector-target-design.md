---
title: AA2 — Derive connector --target description from KNOWN_TARGET_IDS
date: 2026-05-09
risk: MEDIUM
status: approved
author: aa2-connector
---

# AA2: Derive connector `--target` description from `KNOWN_TARGET_IDS`

## Problem

`apps/cli/src/commands/connector.ts` has two citty command definitions with
hardcoded `--target` arg descriptions that do not enumerate valid target IDs:

- `connectorSyncCommand` (line ~184): `"Optional target id to seed when its file does not exist."`
- `connectorStatusCommand` (line ~327): `"Optional target id to filter the report."`

Adding a 5th target requires editing these strings manually — a silent drift
risk.

## Goal

Derive both descriptions from `KNOWN_TARGET_IDS` so `--help` output
auto-enumerates valid target IDs. After this change, adding a target only
requires editing `KNOWN_TARGETS` in `known-targets.ts`.

## Decisions

**Q1 — Member order:** Launch order (matches `KNOWN_TARGETS` array order:
`claude-code | codex | cursor | aider`). `KNOWN_TARGET_IDS` is defined as
`KNOWN_TARGETS.map(t => t.id)` — launch order is its natural order. PR #22's
alphabetic order was a side-effect of Zod `.options`, not a policy for
non-Zod arrays.

**Q2 — Import placement:** Add `KNOWN_TARGET_IDS` to the existing line 16
import (same module, stays well under 80 chars).

**Q3 — Scope:** Strictly the 2 `--target` description sites. No other
surfaces touched.

## Design

### connector.ts — import change

```ts
// line 16: add KNOWN_TARGET_IDS
import { KNOWN_TARGETS, KNOWN_TARGET_IDS, type KnownTargetId, isKnownTargetId } from "../known-targets.js";
```

### connector.ts — description derivation

`connectorSyncCommand` `--target` arg:
```ts
description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to seed when its file does not exist.`,
```

`connectorStatusCommand` `--target` arg:
```ts
description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the report.`,
```

Both produce: `"Optional target id (claude-code | codex | cursor | aider) to seed …"`
and `"Optional target id (claude-code | codex | cursor | aider) to filter …"` at
current `KNOWN_TARGETS` membership.

### connector.test.ts — drift-guard tests

Two `toBe` pinned-format tests parallel to PR #23's pattern
(`apps/cli/test/session.test.ts:222`):

```ts
it("--target description on connectorSyncCommand derives from KNOWN_TARGET_IDS", () => {
  const expected = `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to seed when its file does not exist.`;
  expect(connectorSyncCommand.args?.target?.description).toBe(expected);
});

it("--target description on connectorStatusCommand derives from KNOWN_TARGET_IDS", () => {
  const expected = `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the report.`;
  expect(connectorStatusCommand.args?.target?.description).toBe(expected);
});
```

These tests fail if the description is ever hardcoded again, protecting against
future drift.

## Files changed

- `apps/cli/src/commands/connector.ts` — 1 import change + 2 description sites
- `apps/cli/test/connector.test.ts` — +2 drift-guard tests

## Behavior contract

- Member order in enumeration is launch order from `KNOWN_TARGETS`.
- `--help` output for both `connector sync` and `connector status` shows all
  valid target IDs enclosed in parentheses, separated by ` | `.
- Drift-guard tests fail fast if a description is ever hardcoded again.

## DoD gate

`pnpm verify` GREEN + manual smoke:
```
node apps/cli/dist/cli.js connector sync --help
node apps/cli/dist/cli.js connector status --help
```
Both must show `(claude-code | codex | cursor | aider)` in the `--target` help
line.
