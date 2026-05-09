---
title: Closed-enum tripwire refactor — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-09-aider-connector-target-design.md
  - docs/superpowers/specs/2026-05-09-cursor-connector-target-design.md
  - wiki/entities/cli.md
  - wiki/entities/shared.md
---

# Closed-enum tripwire refactor — design

## §0 TL;DR

The CLI currently keeps four hand-maintained tuple constants
(`AGENT_VALUES`, `RISK_VALUES`, `KNOWN_TARGET_IDS`, `KNOWN_SCOPE_IDS`)
that mirror Zod enums or registry arrays defined elsewhere. The
intended tripwire — `as const satisfies readonly T[]` — is broken:
`satisfies` permits a subset, so when the source enum widens, the
consumer-side tuple compiles cleanly while staying stale. This
defect already produced two CRITICAL fix-ups (cursor → PR #17,
aider → PR #21) where `mega session create --agent <typo>` lied
to the user with an out-of-date valid-agent list.

This slot eliminates the tripwire **structurally** by deriving
each constant from its single source of truth instead of
mirroring it:

- `AGENT_VALUES`, `RISK_VALUES`, `KNOWN_SCOPE_IDS` → replaced by
  `agentIdSchema.options`, `riskLevelSchema.options`,
  `memoryScopeSchema.options` from `@megasaver/shared` (and from
  `@megasaver/core` for the scope schema, depending on where it
  lives — to be confirmed at implementation).
- `KNOWN_TARGET_IDS` (currently duplicated in `apps/cli/src/errors.ts`
  AND `apps/cli/src/commands/connector.ts`) → derived from a new
  single-source-of-truth file `apps/cli/src/known-targets.ts`
  via `KNOWN_TARGETS.map((t) => t.id)`.

After this slot, adding a 5th agent or 5th target requires editing
exactly one file (the source schema or the registry), and every
consumer picks the change up automatically. The tripwire becomes
**impossible to leave stale** because nothing is mirrored.

## §1 Motivation

The `as const satisfies readonly T[]` pattern was repo policy for
"closed-set drift-guard" through v0.1. The intent was: if the
source enum (`agentIdSchema`) widens, the consumer-side tuple
(`AGENT_VALUES`) fails typecheck because `satisfies` would notice
the missing member.

It does not. `satisfies readonly AgentId[]` says "this value's
type must be assignable to `readonly AgentId[]`". A 4-member tuple
where every member is an `AgentId` satisfies this — even after the
enum gains a 5th member, because the existing 4 are still all
`AgentId`s. The check is contravariant in the wrong direction.

Both the cursor (PR #17) and aider (PR #21) slots widened
`agentIdSchema` and shipped CRITICAL silent regressions in
`AGENT_VALUES` (the user-facing error message omitted the new
agent). In each case the bug only surfaced after critic adversarial
review, not during the implementer's normal verification. The
recurrence proves the pattern is structurally insufficient: every
future agent / risk / scope / target widening will create the
same regression unless the pattern changes.

The fix is to remove the duplication, not to harden the imperfect
duplicate-detection mechanism. A constant derived from its source
cannot drift.

## §2 Non-goals

- No behavior change in any CLI error message. Every existing
  string (`error: invalid agent "x", expected: …`,
  `error: invalid risk "x", expected: …`, etc.) is byte-identical
  before and after this slot.
- No new Zod schema additions. The connector-target IDs
  (`claude-code`, `codex`, `cursor`, `aider`) stay CLI-internal —
  no `targetIdSchema` is added to `@megasaver/shared`.
- No widening of `@megasaver/connector-generic-cli`'s public API.
  Removing the `: ConnectorTarget` annotation on individual target
  consts narrows their inferred type but is API-compatible
  (narrower → wider subtype assignment continues to work).
- No closure of unrelated critic backlog (S3–S11, T1, T3–T8,
  U2–U10, V1–V4 + V6–V9, W4–W10, X4–X6, Y3, Y4, Y5, Y7).
- No repo-wide audit of `// Keep in sync with X in Y` comments
  outside the four call sites being refactored.
- No `apps/cli` private app version bump (`private: true`).

## §3 Surface — file-by-file

### 3.1 NEW: `apps/cli/src/known-targets.ts`

CLI-internal canonical registry of every connector target the
CLI knows about. Roughly 30 lines.

```ts
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import { aiderTarget, codexTarget, cursorTarget } from "@megasaver/connector-generic-cli";

export const CLAUDE_CODE_TARGET: ConnectorTarget = {
  id: "claude-code",
  agentId: "claude-code",
  relativePath: "CLAUDE.md",
};

export const KNOWN_TARGETS = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
] as const satisfies readonly ConnectorTarget[];

export const KNOWN_TARGET_IDS: readonly string[] = KNOWN_TARGETS.map((t) => t.id);

export type KnownTargetId = (typeof KNOWN_TARGETS)[number]["id"];

export function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}
```

Notes on the design:

- `CLAUDE_CODE_TARGET` is annotated `: ConnectorTarget` because it
  is a literal object built inline (not exported from the
  `connector-claude-code` package). Its `id` field is therefore
  `string`, not the literal `"claude-code"`. To preserve the
  literal-union resolution in `KnownTargetId`, the `id` field is
  written as `"claude-code"` and TypeScript infers the literal
  before the annotation widens it — but the annotation does widen
  `id` to `string` in the variable's outward type. To get a true
  literal-union `KnownTargetId`, either (a) drop the annotation and
  let the inferred shape stand (it satisfies `ConnectorTarget`
  structurally) or (b) accept that `KnownTargetId` resolves to
  `string` and rely on the runtime `isKnownTargetId` narrowing
  helper. **Decision: drop the `: ConnectorTarget` annotation on
  `CLAUDE_CODE_TARGET` so `id` stays a literal**, mirroring the
  `codexTarget` / `cursorTarget` / `aiderTarget` pattern after
  §3.2's annotation removal. The file becomes:

```ts
export const CLAUDE_CODE_TARGET = {
  id: "claude-code",
  agentId: "claude-code" satisfies AgentId,
  relativePath: "CLAUDE.md",
} as const;
```

- `KNOWN_TARGETS` uses `as const satisfies readonly ConnectorTarget[]`
  here, but its tuple type is preserved by `as const` first — the
  `satisfies` only validates each entry conforms to the wider
  `ConnectorTarget` interface; it does not collapse the literal
  types. This is the correct pairing.

- `KNOWN_TARGET_IDS` is derived via `.map()`. It cannot drift from
  `KNOWN_TARGETS` because they share a single source. The
  `readonly string[]` annotation accepts the runtime `.map()`
  return type; for the literal-union narrowing the `KnownTargetId`
  type covers it at compile time.

- `isKnownTargetId` keeps the existing v0.1 contract used by
  `connector.ts`'s per-target validation gate.

### 3.2 Modify: `packages/connectors/generic-cli/src/targets.ts`

Drop the `: ConnectorTarget` annotation from `codexTarget`,
`cursorTarget`, and `aiderTarget`. Keep `Object.freeze` and the
`satisfies AgentId` pin on `agentId`. Final shape:

```ts
export const codexTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const cursorTarget = Object.freeze({
  id: "cursor",
  agentId: "cursor" satisfies AgentId,
  relativePath: ".cursor/rules/megasaver.mdc",
  header: [/* same as before */].join("\n"),
});

export const aiderTarget = Object.freeze({
  id: "aider",
  agentId: "aider" satisfies AgentId,
  relativePath: "CONVENTIONS.md",
});
```

Resulting types (approximate):
- `codexTarget`: `Readonly<{ id: "codex"; agentId: AgentId; relativePath: "AGENTS.md" }>`
- `cursorTarget`: `Readonly<{ id: "cursor"; agentId: AgentId; relativePath: ".cursor/rules/megasaver.mdc"; header: string }>`
- `aiderTarget`: `Readonly<{ id: "aider"; agentId: AgentId; relativePath: "CONVENTIONS.md" }>`

These are all subtypes of `ConnectorTarget`. Existing consumers
(tests using `codexTarget.relativePath`, registry pushes into a
`ConnectorTarget[]` array, etc.) continue to compile.

`builtinTargets` retains its `: readonly ConnectorTarget[]`
annotation — its public contract is the wider type.

Public surface change: minor (literal narrowing — additive
information, not a breaking change).

### 3.3 Modify: `apps/cli/src/commands/connector.ts`

Remove inline:

```ts
// removed
const CLAUDE_CODE_TARGET: ConnectorTarget = { … };
const KNOWN_TARGETS: readonly ConnectorTarget[] = [ … ];
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor", "aider"] as const;
type KnownTargetId = (typeof KNOWN_TARGET_IDS)[number];
function isKnownTargetId(value: string): value is KnownTargetId { … }
// "Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts." comment
```

Replace with:

```ts
import {
  KNOWN_TARGETS,
  KNOWN_TARGET_IDS,
  type KnownTargetId,
  isKnownTargetId,
} from "../known-targets.js";
```

`TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map(...))` is
unchanged.

Net diff: roughly −15 lines, +1 import block.

### 3.4 Modify: `apps/cli/src/errors.ts`

Remove four constants:

```ts
// removed
const AGENT_VALUES = […] as const satisfies readonly AgentId[];
const RISK_VALUES = […] as const satisfies readonly RiskLevel[];
const KNOWN_TARGET_IDS = […] as const;
const KNOWN_SCOPE_IDS = […] as const satisfies readonly MemoryScope[];
// the three "Keep in sync with X in Y" comments above them
```

Add imports:

```ts
import {
  agentIdSchema,
  riskLevelSchema,
  memoryScopeSchema,  // exact name to be confirmed at implementation;
                      // may be `memoryEntryScopeSchema` depending on where it lives
} from "@megasaver/shared";
import { KNOWN_TARGET_IDS } from "./known-targets.js";
```

Update consumer functions:

- `invalidAgentMessage`: `${AGENT_VALUES.join(" | ")}`  →  `${agentIdSchema.options.join(" | ")}`
- `invalidRiskMessage`: same — `riskLevelSchema.options.join(" | ")`
- `invalidScopeMessage` (if it exists): `memoryScopeSchema.options.join(" | ")`
- `invalidTargetMessage`: `${KNOWN_TARGET_IDS.join(" | ")}` (now imported, not local)

Type-narrowing helpers (`isAgentId`, `isRiskLevel`, `isScope` if
present) refactor analogously: replace `(AGENT_VALUES as readonly string[]).includes(value)` with `agentIdSchema.safeParse(value).success` (if helpers exist) — to be confirmed at implementation. **Decision**: prefer the safe-parse form because it eliminates the array-indexing path entirely.

If the existing `errors.ts` runtime narrowing helpers do not use
the constants directly (they may not — narrowing might happen
elsewhere), this point is moot. Implementation pass clarifies.

Net diff: roughly −12 lines, +2 import lines.

## §4 Behavior contract (must hold)

For every refactored consumer, the runtime output is
**byte-identical** before and after.

- `invalidAgentMessage("totally-fake")` produces
  `'error: invalid agent "totally-fake", expected: aider | claude-code | codex | cursor | generic-cli'`.
- `invalidRiskMessage("ULTRA")` produces
  `'error: invalid risk "ULTRA", expected: low | medium | high | critical'`.
- `invalidTargetMessage("nope")` produces
  `'error: invalid target "nope", expected: claude-code | codex | cursor | aider'`
  (launch order — `KNOWN_TARGETS` insertion order).
- `invalidScopeMessage("global")` (if it exists) produces
  `'error: invalid scope "global", expected: project | session'`.

The order of the agent/risk/scope members is determined by the
Zod schema's `.options` array, which mirrors the enum literal
order in `agentIdSchema = z.enum([...])` etc. Both `agentIdSchema`
and `riskLevelSchema` are alphabetic; `memoryScopeSchema` order is
verified at implementation.

If any test currently pins an order different from the schema's
canonical order, the assertion is updated to match the schema
order, and the change is documented in the implementer's report.

## §5 Test plan

Total new tests: 6 (3 schema-derivation behavior + 2 known-targets
runtime drift-guard + 1 type-level test).

### 5.1 `apps/cli/test/errors.test.ts`

Add three drift-guard tests immediately after the existing
`invalidAgentMessage formats expected list of valid agents` /
`invalidRiskMessage formats expected list of valid risk levels`
tests:

```ts
it("invalidAgentMessage enumerates every agentIdSchema member", async () => {
  const { agentIdSchema } = await import("@megasaver/shared");
  const msg = invalidAgentMessage("nope").message;
  for (const m of agentIdSchema.options) expect(msg).toContain(m);
});

it("invalidRiskMessage enumerates every riskLevelSchema member", async () => {
  const { riskLevelSchema } = await import("@megasaver/shared");
  const msg = invalidRiskMessage("nope").message;
  for (const m of riskLevelSchema.options) expect(msg).toContain(m);
});

it("invalidScopeMessage enumerates every memoryScopeSchema member", async () => {
  const { memoryScopeSchema } = await import("@megasaver/shared");
  const msg = invalidScopeMessage("nope").message;
  for (const m of memoryScopeSchema.options) expect(msg).toContain(m);
});
```

(If `invalidScopeMessage` does not yet exist, the third test is
omitted and the +6 budget drops to +5. To be confirmed at
implementation.)

### 5.2 NEW: `apps/cli/test/known-targets.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { KNOWN_TARGETS, KNOWN_TARGET_IDS, isKnownTargetId } from "../src/known-targets.js";

describe("known-targets", () => {
  it("KNOWN_TARGET_IDS derives from KNOWN_TARGETS in launch order", () => {
    expect(KNOWN_TARGET_IDS).toEqual(KNOWN_TARGETS.map((t) => t.id));
  });

  it("isKnownTargetId narrows known ids and rejects unknown ones", () => {
    expect(isKnownTargetId("claude-code")).toBe(true);
    expect(isKnownTargetId("aider")).toBe(true);
    expect(isKnownTargetId("totally-fake")).toBe(false);
  });
});
```

### 5.3 Type-level test (optional, recommended)

Either as `apps/cli/test/known-targets.test-d.ts` (if the project
has Vitest's type-test mode wired up) or as an inline
`expectTypeOf` block inside `known-targets.test.ts`:

```ts
import { expectTypeOf } from "vitest";
import type { KnownTargetId } from "../src/known-targets.js";

expectTypeOf<KnownTargetId>().toEqualTypeOf<"claude-code" | "codex" | "cursor" | "aider">();
```

This locks the literal-union resolution at the type level. If a
future contributor adds a target without updating `KNOWN_TARGETS`
correctly, the type test fails at `tsc -b --noEmit`. **Decision**:
inline the `expectTypeOf` call inside `known-targets.test.ts` for
locality. If `expectTypeOf` is not available in the project's
Vitest version, fall back to a manual `@ts-expect-error` comment
test.

### 5.4 Existing tests — should remain green

- `errors.test.ts:172-178` (Y1 fix) pins
  `'error: invalid agent "totally-fake", expected: aider | claude-code | codex | cursor | generic-cli'`
  — derived from `agentIdSchema.options` produces the same string,
  so this test passes byte-identically.
- `session.test.ts:138` (Y1 fix) — same.
- `connector.test.ts:67` and `connector-status.test.ts:63` —
  pin `'error: invalid target "nope", expected: claude-code | codex | cursor | aider'`.
  Derived from `KNOWN_TARGET_IDS` (= launch order) produces the
  same string. Passes byte-identically.
- All other CLI tests — no behavior change, all pass.

Total project test count: 466 → ~472 (+6 net new).

## §6 Risk

**MEDIUM**. Cross-cutting refactor with no behavior change:

- `apps/cli/src/errors.ts` — 4 constants removed, 4 schema-based
  derivations added. Output strings byte-identical (covered by
  pinned tests).
- `apps/cli/src/commands/connector.ts` — ~15 lines net removed
  (registry moved out). Behavior identical.
- `packages/connectors/generic-cli/src/targets.ts` — type
  annotations removed on 3 const exports. Subtype-compatible.
- `apps/cli/src/known-targets.ts` (new) — ~30 lines, single
  source of truth.

The full superpowers chain (TDD, code-reviewer, critic) applies.
The pre-merge critic pass is **especially valuable here** — the
slot's whole purpose is to prevent the recurring CRITICAL bug class
that critic caught on cursor and aider. A successful slot leaves
the codebase strictly safer for every future enum widening.

## §7 Success criteria

After this slot:

1. Adding a 5th member to `agentIdSchema` requires editing exactly
   `packages/shared/src/agent-id.ts`. No CLI-side mirror needs
   updating; `invalidAgentMessage` automatically picks up the new
   member; `--agent description` drift-guard tests still pass
   (they iterate `agentIdSchema.options`).
2. Adding a 5th connector target requires editing exactly
   `apps/cli/src/known-targets.ts` (or one of the connector
   manifest packages plus `known-targets.ts`'s registry). No
   `errors.ts` mirror needs updating.
3. The repository contains zero `as const satisfies readonly T[]`
   patterns whose source-of-truth is a Zod enum elsewhere. The
   pattern survives only for `KNOWN_TARGETS` itself, where it is
   correct (the registry IS the source-of-truth, not a mirror).
4. The recurring "fix-up commit" pattern observed across cursor
   PR #17 and aider PR #21 does not recur in the next connector
   slot.

Success is verified by:
- `pnpm verify` green at HEAD.
- The new `known-targets.test.ts` passes.
- Existing pinned tests pass byte-identically (no string changes).
- Type-level test asserts the literal union.
- Critic re-pass on the open PR finds no CRITICAL or MAJOR
  closed-enum drift findings.

## §8 Migration / compatibility

No migration required. No persistent state touched. No public
API breaking change (target type narrowing is a subtype
refinement; consumers compile unchanged).

The existing `// Keep in sync with X in Y` comments in `errors.ts`
and `connector.ts` are removed because the duplication itself is
removed. No new "Keep in sync" comments are introduced — the
derivation is its own comment.

## §9 Out of scope (explicit)

- `targetIdSchema` Zod enum (CLI-internal target IDs do not
  belong in `@megasaver/shared`).
- `Equal<A, B>` type-utility helper repo-wide (not needed; Zod's
  `schema.options` returns a `readonly [...]` tuple that
  TypeScript handles directly).
- Refactoring `KNOWN_TARGETS` itself into a Zod schema or generated
  registry. The registry IS the source of truth and stays manual.
- Repo-wide audit of every `// Keep in sync` comment.
- Backlog closure (Y3 docs drift, Y4 public-export aider, Y5 noop
  coverage, Y7 ordering convention; S/T/U/V/W/X series).
- `apps/cli` private app version bump.
