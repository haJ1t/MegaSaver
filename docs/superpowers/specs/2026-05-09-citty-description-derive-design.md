---
title: Citty description derive (Z1) — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-09-closed-enum-tripwire-design.md
  - docs/superpowers/specs/2026-05-09-aider-connector-target-design.md
  - docs/superpowers/specs/2026-05-09-cursor-connector-target-design.md
  - wiki/entities/cli.md
---

# Citty description derive (Z1) — design

## §0 TL;DR

PR #22 (closed-enum tripwire refactor) eliminated the broken
`as const satisfies readonly T[]` mirror pattern from
`apps/cli/src/errors.ts`, but it left the same bug class alive
on a quieter surface: 5 citty `description` string literals in
`session/create.ts`, `session/update.ts`, and `memory/create.ts`
still hand-mirror the same enum lists with "Keep in sync"
comments. The next time someone widens `agentIdSchema`,
`riskLevelSchema`, or `memoryScopeSchema`, the `--help` output
will go stale silently — exactly the cursor PR #17 + aider PR
#21 CRITICAL bug class translated to the help-text surface.

This slot completes PR #22's promise by deriving each citty
`description` string from its source schema via module-load
template interpolation:

```ts
description: `Agent id (${agentIdSchema.options.join(" | ")}).`,
```

After this slot, **adding a 5th agent or changing a risk level
requires editing exactly the source schema in `@megasaver/shared`
or `@megasaver/core`** — error messages AND help text both
auto-update. The "Keep in sync" comments are removed because
the derivation is its own documentation.

## §1 Motivation

PR #22's critic explicitly flagged this as **Z1 / FIRST-CRITICAL**:

> [IMPORTANT] Recurrence-prevention promise is incomplete — three
> citty `description` strings still hand-mirror enum lists. The
> next agent widening will produce stale `--help` output, exactly
> the bug class the slot promises to prevent (just for `--help`
> output rather than error messages).

PR #22 §7 success criteria stated: "Adding a 5th member to
`agentIdSchema` requires editing exactly
`packages/shared/src/agent-id.ts`. No CLI-side mirror needs
updating." This was strictly true for `errors.ts` but not for
the citty descriptions in 3 other files. Z1 is the slot that
makes that promise structurally true repo-wide.

The bug class itself is the same one that produced the cursor
+ aider CRITICAL fix-ups: a manual mirror of a closed enum,
maintained by a "Keep in sync" comment, fails open when the
source widens. The fix is the same: derive instead of mirror.

## §2 Non-goals

- **No new schema additions.** `agentIdSchema` (in
  `@megasaver/shared`), `riskLevelSchema` (in
  `@megasaver/shared`), and `memoryScopeSchema` (in
  `@megasaver/core`) are already public exports — no new
  schemas are introduced.
- **No `describeEnum()` helper.** Five sites is below the YAGNI
  threshold for extracting an abstraction; inline template
  interpolation is clearer and shorter.
- **No exploration of citty thunk-style descriptions.** Module-
  load string interpolation evaluates once at `defineCommand`
  call time and is sufficient. citty's `description: string`
  contract is preserved.
- **No changes to other description strings** (project name,
  store override, session id, content, etc.). They are not
  schema-bound and do not exhibit the bug class.
- **No closure of Z2–Z4 backlog** (vitest `typecheck: true`
  mode wire, `.test-d.ts` regression suite, `wiki/entities/cli.md`
  surface-derivation documentation) — separate slots.
- **No closure of unrelated critic backlog** (S3–S11, T1, T3–T8,
  U2–U10, V1–V4 + V6–V9, W4–W10, X4–X6, Y3, Y4, Y5, Y7).
- **No `apps/cli` private app version bump.** `private: true`,
  changeset level patch.
- **No additional surfaces audited.** This slot's scope is the
  exact 5 citty description sites identified in PR #22's critic
  review. Other potential drift sites in connector targets, doctor
  output, etc., are not in scope.

## §3 Surface — file-by-file

### 3.1 Modify: `apps/cli/src/commands/memory/create.ts`

Add `memoryScopeSchema` to the existing `@megasaver/core` import
(it already imports `MemoryScope` type or similar).

```ts
import { memoryScopeSchema } from "@megasaver/core";
```

Replace the description (around line 155) and remove the "Keep
in sync" comment immediately above (around line 151):

```ts
// REMOVED: // Keep in sync with memoryScopeSchema in @megasaver/core.
scope: {
  type: "string",
  required: true,
  description: `Memory scope (${memoryScopeSchema.options.join(" | ")}).`,
},
```

`memoryScopeSchema.options` evaluates to `["project", "session"]`
at module load. Resulting description is byte-identical to the
prior hardcoded `"Memory scope (project | session)."`.

### 3.2 Modify: `apps/cli/src/commands/session/create.ts`

Add `agentIdSchema, riskLevelSchema` to the existing
`@megasaver/shared` import (it already imports `AgentId`,
`RiskLevel`, etc.).

```ts
import { agentIdSchema, riskLevelSchema } from "@megasaver/shared";
```

Replace the two descriptions (around lines 127, 131) and remove
the two "Keep in sync" comments (around lines 126, 129):

```ts
// REMOVED: // Keep in sync with agentIdSchema in @megasaver/shared.
agent: {
  type: "string",
  required: true,
  description: `Agent id (${agentIdSchema.options.join(" | ")}).`,
},
// REMOVED: // Keep in sync with riskLevelSchema in @megasaver/shared.
risk: {
  type: "string",
  description: `Risk level (${riskLevelSchema.options.join(" | ")}). Default: medium.`,
},
```

`agentIdSchema.options` = `["aider", "claude-code", "codex", "cursor", "generic-cli"]` (alphabetic).
`riskLevelSchema.options` = `["low", "medium", "high", "critical"]` (severity order).

Resulting strings are byte-identical to the existing pre-Y1/Y2
strings — the `Default: medium.` suffix is preserved.

### 3.3 Modify: `apps/cli/src/commands/session/update.ts`

Same import addition as §3.2:

```ts
import { agentIdSchema, riskLevelSchema } from "@megasaver/shared";
```

Replace the two descriptions (around lines 128, 134) and remove
the two "Keep in sync" comments (around lines 126, 131):

```ts
// REMOVED: // Keep in sync with riskLevelSchema in @megasaver/shared.
risk: {
  type: "string",
  description: `New risk level (${riskLevelSchema.options.join(" | ")}).`,
},
// REMOVED: // Keep in sync with agentIdSchema in @megasaver/shared.
agent: {
  type: "string",
  description: `New agent id (${agentIdSchema.options.join(" | ")}).`,
},
```

The `New ` prefix is preserved (update flow uses "New …"
phrasing because all fields are optional patches). No
`Default: …` suffix on update's `risk` (no default for partial
update).

### 3.4 Test additions — drift-guards for risk + scope

The existing `session.test.ts` already contains drift-guard
tests for `--agent` on both `sessionCreateCommand` and
`sessionUpdateCommand` (added in Y1 + Y2 fix-ups respectively).
Z1 adds three parallel drift-guards covering the now-derived
`--risk` (×2 sites) and `--scope` (×1 site) descriptions.

**`apps/cli/test/session.test.ts`** (+2 tests):

```ts
it("--risk description on create lists every riskLevelSchema member", async () => {
  const { riskLevelSchema } = await import("@megasaver/shared");
  const desc = sessionCreateCommand.args?.risk?.description ?? "";
  for (const m of riskLevelSchema.options) expect(desc).toContain(m);
});

it("--risk description on update lists every riskLevelSchema member", async () => {
  const { riskLevelSchema } = await import("@megasaver/shared");
  const desc = sessionUpdateCommand.args?.risk?.description ?? "";
  for (const m of riskLevelSchema.options) expect(desc).toContain(m);
});
```

**`apps/cli/test/memory.test.ts`** (+1 test):

```ts
it("--scope description on memory create lists every memoryScopeSchema member", async () => {
  const { memoryScopeSchema } = await import("@megasaver/core");
  const desc = memoryCreateCommand.args?.scope?.description ?? "";
  for (const m of memoryScopeSchema.options) expect(desc).toContain(m);
});
```

The pattern (dynamic schema import + iterate `.options` +
`toContain`) mirrors the existing agent drift-guards, so the
contract is uniform across all three closed-set surfaces.

## §4 Behavior contract (must hold)

For every refactored description, the resulting string is
**byte-identical** before and after this slot.

- `sessionCreateCommand.args.agent.description` =
  `"Agent id (aider | claude-code | codex | cursor | generic-cli)."`
- `sessionCreateCommand.args.risk.description` =
  `"Risk level (low | medium | high | critical). Default: medium."`
- `sessionUpdateCommand.args.risk.description` =
  `"New risk level (low | medium | high | critical)."`
- `sessionUpdateCommand.args.agent.description` =
  `"New agent id (aider | claude-code | codex | cursor | generic-cli)."`
- `memoryCreateCommand.args.scope.description` =
  `"Memory scope (project | session)."`

The order of members is determined by each schema's declaration
order. `agentIdSchema = z.enum(["aider", "claude-code", "codex", "cursor", "generic-cli"])`
is alphabetic. `riskLevelSchema` is severity order
(low → medium → high → critical). `memoryScopeSchema =
z.enum(["project", "session"])`.

If any current test or snapshot pins a description with a
different member order, the test's expectation is updated to
match the schema's canonical order, and the change is documented
in the implementer's report. (PR #22's success criteria
established the same convention for error messages: schema is
the source of truth for ordering.)

## §5 Test plan

Total new tests: 3 (2 risk drift-guards + 1 scope drift-guard).

**`apps/cli/test/session.test.ts`** (+2):
- `--risk description on create lists every riskLevelSchema member`
- `--risk description on update lists every riskLevelSchema member`

**`apps/cli/test/memory.test.ts`** (+1):
- `--scope description on memory create lists every memoryScopeSchema member`

**Existing tests — should remain green:**
- `--agent description on create lists every agentIdSchema member`
  (Y1 fix) — derived string contains every option, passes byte-
  identically.
- `--agent description on update lists every agentIdSchema member`
  (Y2 fix) — same.
- All other `session.test.ts`, `memory.test.ts` tests are
  description-string-independent.

Total project test count: 474 → 477.

## §6 Risk

**MEDIUM**. The slot touches three CLI command files but the
behavior contract is byte-identical strings. No runtime logic
changes; only the source of the description literals shifts
from inline to schema-derived.

- `apps/cli/src/commands/memory/create.ts` — 1 description
  derived, 1 import added, 1 comment removed.
- `apps/cli/src/commands/session/create.ts` — 2 descriptions
  derived, 1 import line widened, 2 comments removed.
- `apps/cli/src/commands/session/update.ts` — 2 descriptions
  derived, 1 import line widened, 2 comments removed.

Recurrence prevention: after this slot, the next agent / risk /
scope schema widening triggers zero CLI-side updates. The
existing drift-guard tests (5 total: 2 agent + 2 risk + 1 scope)
verify each member appears in its description. Full superpowers
chain (TDD, code-reviewer, critic) before merge.

## §7 Success criteria

After this slot:

1. Adding a 5th member to `agentIdSchema`, `riskLevelSchema`, or
   `memoryScopeSchema` requires editing exactly its declaring
   file in `@megasaver/shared` or `@megasaver/core`. No CLI-side
   mirror needs updating; both error messages (PR #22) and help
   text (this slot) auto-update.
2. The repository contains zero "Keep in sync with X in Y"
   comments above citty `description` strings. The five
   instances in `session/create.ts`, `session/update.ts`, and
   `memory/create.ts` are removed.
3. `mega session create --help`, `mega session update <id>
   --help`, and `mega memory create --help` all show
   schema-derived agent / risk / scope listings.

Verification:
- `pnpm verify` green at HEAD.
- The new drift-guard tests pass.
- Existing pinned-string tests pass byte-identically (no string
  changes).
- Manual smoke: each command's `--help` output matches the
  byte-identical pre-refactor strings.

## §8 Migration / compatibility

No migration required. No persistent state touched. CLI binary
contract is unchanged (description strings byte-identical).
External consumers parsing `--help` (none expected for v0.2)
would see no change.

## §9 Out of scope (explicit)

- `describeEnum()` helper extraction (YAGNI at 5 sites).
- citty thunk-style descriptions (module-load interpolation
  suffices; thunk would only matter if descriptions needed to
  observe runtime state).
- Other `description:` strings not bound to closed-enum schemas
  (`Project name (must already exist).`, `Override store directory.`,
  etc. — they describe domain concepts, not enums).
- Z2 (`vitest typecheck: true` mode wire) — separate slot.
- Z3 (`.test-d.ts` regression suite for `KnownTargetId` literal
  union pin) — separate slot.
- Z4 (`wiki/entities/cli.md` schema-derived vs hand-mirrored
  surface documentation) — separate slot.
- Backlog closure (S/T/U/V/W/X/Y series).
- `apps/cli` private app version bump.
