---
title: Context Gate / Mega Saver Mode — epic spec (AA series)
status: proposed
risk: MIXED
created: 2026-05-10
updated: 2026-05-10
input-source: ../../MegaSaver_Context_Gate_Detailed_Plan.txt
revision: 2  # critic REVISE pass — F-CRIT-1..3 + F-MAJ-1 resolved, BB7 split, TokenSaverMode hoisted to @megasaver/shared
---

# AA1 — Context Gate / Mega Saver Mode epic spec

> This is an **epic** spec: it locks scope, sequence, dependency
> graph, security boundaries, and closed-enum surfaces for an
> 11-PR effort (BB1 … BB11) that spans v0.5 → v1.0. Each sub-PR
> carries its own child spec restating its risk level per
> `CLAUDE.md` §12; the `MIXED` risk in frontmatter reflects that
> aggregate (LOW schema additions → CRITICAL command execution).
> The source of intent is the user's 1777-line plan referenced in
> `input-source`. This spec maps that plan onto the v0.4 codebase,
> resolves ambiguities, and locks decisions; it deliberately does
> not duplicate plan content. Plan citations use `plan L<n>` for
> single lines and `plan L<a>–L<b>` for ranges.
>
> **Revision 2** addresses an adversarial critic pass:
> `TokenSaverMode` is hoisted to `@megasaver/shared` (kills a
> latent cycle); `evaluatePathRead` / `resolveSafeReadPath` are
> split across BB3/BB5; `recursive_megasaver` is given a real
> detection mechanism via `MEGASAVER_ORIGIN_PID`; BB7 splits into
> BB7a (HIGH, no-spawn) + BB7b (CRITICAL, spawn). See §19 for
> the rejected alternatives and §22 for the locked-state matrix.

---

## §1 Goal & non-goals

**User-visible promise** (plan L21): *"Open GUI → Choose session →
Enable Mega Saver Mode → Done."* Token saving switches on per
session with one click; raw evidence stays local; the agent sees
only the most relevant excerpts with measurable byte savings.

**v1.0 done means…** (mirrors plan "Final summary" L1747–L1777 and
"Example final user flow" L1672–L1702):

- Every Mega Saver session carries a `tokenSaver` schema object
  whose `enabled`, `mode`, `maxReturnedBytes`, `storeRawOutput`,
  `redactSecrets`, `autoRepair`, `createdAt`, `updatedAt` are
  persisted in the existing JSON directory store (atomic write,
  POSIX dir-fsync, Windows-aware) without breaking pre-AA
  sessions.
- A `mega session saver {enable,disable,status,stats}` CLI
  subcommand surface exists with `--json` parity per
  `apps/cli/test/json-failure-paths.test.ts` precedent.
- A `mega output {exec,file,filter,chunk}` CLI surface routes
  raw tool output through redact → chunk → rank → fit →
  summarize and writes both the raw chunk set (under
  `<store>/content/<projectId>/<sessionId>/<chunkSetId>.json`)
  and a stats event (under
  `<store>/stats/<projectId>/<sessionId>.json`). The `exec`
  subcommand spawns a policy-gated child process; the other
  three operate on on-disk inputs.
- A `mega mcp {install,repair,status,uninstall}` CLI surface
  performs idempotent agent config installation; companion GUI
  AgentSetupDoctor view drives the same operations.
- The real `@megasaver/mcp-bridge` ships over `stdio` first
  exposing `mega_fetch_chunk`, `mega_read_file`, `mega_recall`,
  `mega_run_command` (alphabetic; see §8), policy-gated and
  redaction-pipelined, replacing the v0.3 `not_implemented`
  placeholder without redesigning the `createBridge(config)` API.
- The GUI Sessions detail pane carries a `TokenSaverPanel` (mode
  picker, enable/disable, savings ratio, recent events, raw/sent
  viewer per plan L387–L411) and the AgentSetupDoctor view drives
  setup/repair without the user touching a terminal.
- Connector sync writes an additive
  `<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->` block per agent file
  alongside the existing `MEGA SAVER:BEGIN/END` block (§7).
- `pnpm verify` green; tuple-ordering pins land for every closed
  enum introduced by the epic (§17); `pnpm conventions:check`
  green with any new anti-pattern entries source-synced from
  `docs/conventions/`.

**User-promise milestone (F-MAJ-10 resolution).** The
user-visible promise (*"Open GUI → Click Enable → Done"*) is
fully deliverable at **BB11** (the renumbered AgentSetupDoctor +
connector CONTEXT_GATE block PR). **BB10** (the renumbered GUI
TokenSaverPanel + bridge routes PR) ships the enable-flow but
not the agent-instruction block; users invoking the CLI
`connector sync` after BB10 see legacy-only connector files
until BB11 lands the additive sentinel.

**Non-goals carried out of v1.0** (scattered through plan
L1330–L1606):

- **Auth.** No bearer tokens, no per-project ACLs on the MCP
  bridge in v1.0. `stdio` trusts the launching process per MCP
  reference convention (plan L568, HH placeholder spec §4).
- **Multi-user / team chatops.** Mega Saver remains single-
  developer per `CLAUDE.md` §1.
- **Real-time push to GUI.** GUI re-fetches affected lists on
  mutation per LL precedent §2; no WebSocket / SSE inside the
  bridge HTTP layer in v1.0.
- **Model proxying.** Mega Saver never forwards a request to a
  model provider (`CLAUDE.md` §1: "We are NOT a model proxy.").
- **External service dependency.** All ranking / retrieval /
  redaction is local. No embedding API, no remote vector store
  (plan "Important design principles" #8 L1653).

---

## §2 Architectural deltas vs the plan

The plan proposes five new workspace packages (`context-gate`,
`output-filter`, `content-store`, `retrieval`, `stats`). Four
contentious calls follow; each is **locked**, with the rejected
alternative captured in §19. Revision 2 adds two further locked
mappings (TokenSaverMode location, identifier-scope split).

### §2a `@megasaver/context-gate` — fold into `@megasaver/core` as a module (with deferred-extraction trigger)

**Lock: do NOT create a new `@megasaver/context-gate` package
in BB1–BB7b.** The orchestration code lands as
`packages/core/src/context-gate/` behind
`packages/core/src/context-gate.ts` (public re-export).

Reasoning. `@megasaver/core` already owns sessions, the JSON
directory registry, the in-memory registry, atomic writes, and
the Zod boundary. Promoting context-gate to its own package
would force it to:

1. Import `Session` / `CoreRegistry` from `@megasaver/core`,
2. Be imported back by every CLI command and the GUI bridge,
3. Re-export the same types core already publishes.

That is a thin facade over a single orchestrator — the LL-spec
class of premature splits. The plan's diagram (L91–L114) shows
context-gate as a coordinator, not a domain. Coordinators belong
inside the orchestrator package (core), not as their own
workspace member.

Cycle risk lock: `core/context-gate/` imports `policy`,
`output-filter`, `content-store`, `retrieval`, and `stats` —
**none of those packages may import `@megasaver/core`**. They
return data; core composes. This direction matches the dependency
arrow already enforced for `connectors/shared` (which never
imports core; CLI assembles).

**Deferred-extraction trigger (Revision 2 compromise).** The
critic raised a principled objection — agent-agnostic-core could
be read to require context-gate to be its own package, separating
orchestration from the entity layer. The pragma was sound (avoid
premature split) but the principle deserves a date with data.
The locked deferred milestone:

> After **BB7b** lands and the orchestrator's actual size is
> known, audit `packages/core/src/context-gate/`. If total LOC
> across `enable.ts + disable.ts + run.ts + session-policy.ts +
> context-hints.ts + types.ts` exceeds **500 lines**, extract to
> `@megasaver/context-gate` package as a separate post-BB7b
> chore PR (call it BB12 if it lands inside the AA epic; or a
> standalone post-epic PR). If ≤ 500 LOC, keep folded.

The audit is a checklist item in the BB7b acceptance criteria
(§14 BB7b row "Post-merge audit: invoke `wc -l
packages/core/src/context-gate/*.ts` and write the result into
the BB7b verifier evidence bundle").

Files (BB1–BB7b period). `packages/core/src/context-gate/{enable.ts,
disable.ts, run.ts, session-policy.ts, context-hints.ts,
types.ts}` plus `packages/core/src/context-gate.ts` (≤ 20-line
barrel). Each file ≤ 300 LOC per `CLAUDE.md` §8.

### §2b `@megasaver/policy` — promote to its own v0.5 package

**Lock: yes, promote.** Policy is a v0.5 package — the third PR
in sequence (BB3), not v0.9 Advanced roadmap.

Reasoning. Plan L1180–L1247 ("Security requirements") tucks the
ALLOWED_COMMANDS / DANGEROUS_PATTERNS / redaction set into the
v0.9 roadmap, but two downstream packages would have to either
(a) import that policy code via a deferred TODO or (b) hard-code
their own copy. Both violate `CLAUDE.md` §13 (no
half-implementations, no premature abstraction). Specifically:

- `@megasaver/output-filter` (BB5) MUST redact secrets BEFORE
  chunks are persisted by `@megasaver/content-store` (plan
  L1248: "Redact before returning and preferably before
  storing"). Redaction belongs to policy.
- `@megasaver/mcp-bridge` (BB8) MUST consult ALLOWED_COMMANDS
  and DANGEROUS_PATTERNS BEFORE spawning a child process via
  `mega_run_command`. Command allow/deny belongs to policy.
- `mega output exec` (BB7b) hits the same surface from the CLI
  side.

Promoting policy to its own package early gives all three
consumers a single Zod-validated, tuple-pinned source of truth.
The v0.9 plan item ("permissions file") becomes a per-project
override layered ON TOP of the v0.5 baseline — same API,
additional ruleset, not a redesign.

Public surface locked in §9 below.

### §2c Existing placeholders — extend mcp-bridge, leave skill-packs untouched

**Lock for `@megasaver/mcp-bridge`: extend, do not redesign.** The
v0.3 placeholder API surface is preserved verbatim:

- `createBridge(config: McpBridgeConfig): McpBridge` factory
  remains the only entry point.
- `McpBridge.transport: McpTransport` remains a `readonly`
  property; `start()` / `stop()` remain `Promise<void>`.
- `McpTransport = ["stdio", "sse"]` enum order remains
  launch-order (HH spec §7;
  `packages/mcp-bridge/src/transport.ts:6`). v0.5 keeps both
  members; only stdio actually implements (§8).

What changes:

- `McpBridgeErrorCode` widens from the v0.3 single member
  (`["not_implemented"]`) to the full alphabetic set (§17). The
  `not_implemented` member is removed because every entrypoint
  now has a real implementation (per `CLAUDE.md` §13 "no
  half-implementations"). HH's reserved future code
  `resource_not_found` is included in the widened set
  (F-MAJ-9: HH spec §7 reserved it; we honour the reservation).
- `McpBridge` gains an internal tool registry, but the public
  type signature does NOT — tools are MCP-protocol-visible, not
  TypeScript-visible. The `createBridge` config gains optional
  `registry` and `policy` injection slots (DI for testability;
  no breaking change since v0.3 placeholder rejected
  `start()`).
- The bridge test file
  (`packages/mcp-bridge/test/bridge.test.ts:5–27`) is replaced
  end-to-end in BB8; the placeholder reject-on-`not_implemented`
  expectations are deliberately removed because the real
  implementation supersedes them.

**Lock for `@megasaver/skill-packs`: untouched by this epic.** No
AA-series PR touches `packages/skill-packs/`. Agent instruction
templates (plan L666–L690) ship via the **connector** path (a
markdown sentinel block), not the skill-packs path (Zod
manifests). Skill-packs remains the v0.3 placeholder it is today
and is filled by a separate post-v1.0 spec.

### §2d Naming — locked (Revision 2: identifier scope split)

The plan inconsistently uses "Mega Saver Mode" (L20), "Context
Gate" (L75), `tokenSaver` (L221), `mega session saver`
(L519–L526), and `@megasaver/context-gate` (L78). Getting this
wrong now means drift forever. Locked mapping (no deviations
permitted across the epic):

| Audience / Layer                                  | Name to use                                      |
|---------------------------------------------------|--------------------------------------------------|
| GUI labels, modal copy, button text               | "Mega Saver Mode"                                |
| User-facing docs, error message text              | "Mega Saver Mode"                                |
| Orchestrator code identifiers (run/enable/disable, package name candidate) | `ContextGate` / `contextGate`                    |
| Session-state code identifiers (schema field, UI panel, settings type, registry method) | `tokenSaver` / `TokenSaverPanel` / `TokenSaverSettings` / `TokenSaverMode` |
| Module / file paths inside packages               | `context-gate/` (kebab) for orchestrator; `token-saver.ts` for session-state types |
| Session schema field                              | `tokenSaver` (camelCase)                         |
| CLI namespace (existing in plan L519)             | `mega session saver`                             |
| CLI output subcommand namespace                   | `mega output`                                    |
| CLI MCP subcommand namespace                      | `mega mcp`                                       |
| Connector instruction sentinel                    | `MEGA SAVER:CONTEXT_GATE`                        |
| Stats files on disk                               | `<store>/stats/…`                                |
| Content store files on disk                       | `<store>/content/…`                              |

**Identifier-scope split (Revision 2; resolves F-MED-3).**
The orchestrator and the session-state object are different
scopes and DO carry different names. The orchestrator
("ContextGate") runs the pipeline; the session-state object
("tokenSaver" / "TokenSaverSettings") is the user-toggleable
configuration that the orchestrator reads. Mixing them — calling
the schema field `contextGate` or the orchestrator
`runTokenSaver` — is rejected.

The asymmetry between code and user copy is also intentional:
humans read product names ("Mega Saver Mode"), agents read code
names. Mixing them in the same surface (e.g. an identifier
called `megaSaverMode`) is rejected.

### §2e `TokenSaverMode` location — `@megasaver/shared` (Revision 2)

**Lock: `tokenSaverModeSchema`, `TokenSaverMode`, and
`modeToBudget(mode)` live in `@megasaver/shared`.** Not in
`@megasaver/core`. Not in `@megasaver/output-filter`. Not in any
new package.

Reasoning. Revision 1 of this spec located these symbols in
`packages/core/src/token-saver.ts` and had `output-filter`
import them from `@megasaver/core`. That contradicted the §3
cycle guardrail ("`@megasaver/output-filter` MUST NOT import
`@megasaver/core`"). The critic flagged this as F-CRIT-1.

Resolution: `@megasaver/shared` is already the dependency-root
package of the workspace (it exports `RiskLevel`, `AgentId`,
the ID UUID schemas, and post-PP `titleSchema`). It is the
natural home for cross-cutting closed enums. `TokenSaverMode`
joins that company. Both `core` and `output-filter` import from
`shared`; `core` does NOT import from `output-filter`; the
cycle does not close.

Files (BB1):

- `packages/shared/src/token-saver-mode.ts` (NEW; the enum +
  schema + `modeToBudget`).
- `packages/shared/test/token-saver-mode.test-d.ts` (NEW; the
  AA3 tuple-ordering pin — moved from
  `packages/core/test/session.test-d.ts`).
- `packages/shared/test/token-saver-mode.test.ts` (NEW; runtime
  parse + `modeToBudget` cases).
- `packages/shared/src/index.ts` (extended barrel
  re-export — append `export * from "./token-saver-mode.js";`).

`packages/core/src/session.ts` still extends with `tokenSaver`;
`packages/core/src/token-saver.ts` (NEW; BB1) still hosts
`tokenSaverSettingsSchema` + `defaultTokenSaverSettings(now)`
(both depend on the mode but are session-state types, not the
mode itself; they import `tokenSaverModeSchema` from `shared`).

The Revision-2 final dependency graph (§3) reflects this move.

---

## §3 Workspace layout after AA-series complete

### §3a Package inventory

```
packages/
  shared/                  EXTENDED  — BB1 adds token-saver-mode
  core/                    EXTENDED  — BB1 adds tokenSaver field + settings;
                                       BB7a wires context-gate orchestrator
  policy/                  NEW BB3   — evaluateCommand, evaluatePathRead,
                                       redact, PolicyDenyCode
  content-store/           NEW BB4   — ChunkSet persistence, retention,
                                       ContentStoreErrorCode
  output-filter/           NEW BB5   — filterOutput pipeline, RankFeatureName,
                                       OutputSourceKind, resolveSafeReadPath
  retrieval/               NEW BB6   — BM25, DerivedIntent
  stats/                   NEW BB6   — SessionTokenSaverStats, TokenSaverEvent
  mcp-bridge/              EXTENDED  — BB8 fills v0.3 placeholder; +McpToolName,
                                       widened McpBridgeErrorCode
  connectors/shared/       EXTENDED  — BB11 adds context-gate-block renderer
  skill-packs/             UNTOUCHED — see §2c

apps/
  cli/src/commands/
    session/saver/         NEW BB2   — enable/disable/status/stats
    output/                NEW       — file/filter/chunk (BB7a); exec (BB7b)
    mcp/                   NEW BB8   — install/repair/status/uninstall
  gui/
    src/components/        NEW       — token-saver-{panel,modal,stats},
                                       savings-badge, agent-setup-row (BB10/BB11)
    src/views/             EXTENDED  — sessions-{list,detail} extended (BB10);
                                       agent-setup-doctor NEW (BB11)
    bridge/routes/         NEW       — token-saver.ts (BB10),
                                       mcp-setup.ts (BB11)
```

Public-surface details (exports, schemas, test files) for each
package live in the relevant §-section (§4 core, §9 policy, §10
content-store, §11 output-filter, §12 retrieval, §13 stats, §8
mcp-bridge, §7 connectors/shared).

### §3b Dependency graph (final, post-BB11)

```
            @megasaver/shared           (TokenSaverMode, modeToBudget, ids,
                  ▲                       AgentId, RiskLevel, titleSchema)
                  │
       ┌──────────┼──────────┬─────────────┬─────────────┐
       │          │          │             │             │
       ▼          ▼          ▼             ▼             ▼
   policy   output-filter content-store retrieval     stats
       │       │       ▲        │           ▲           ▲
       │       │       │        │           │           │
       │       │       └────────┘           │           │
       │       │  (content-store imports OutputSourceKind)
       │       │                            │           │
       │       └────────────────────────────┘           │
       │           (retrieval consumes filter results)  │
       │                                                │
       │       ┌────────────────────────────────────────┘
       │       │  (stats imports OutputSourceKind)
       │       │
       └───────┴─────────────────┐
                                 ▼
                         @megasaver/core
                         (context-gate inside core)
                                 │
                                 ▼
                          @megasaver/mcp-bridge
                                 │
                                 ▼
                       apps/cli, apps/gui, connectors/shared
```

### §3c Cycle guardrails (MANDATORY — dep-graph tests in BB3/BB4/BB5/BB6)

| Package                        | May depend on                                                            | MUST NOT depend on              |
|--------------------------------|--------------------------------------------------------------------------|---------------------------------|
| `@megasaver/shared`            | (none)                                                                   | every other Mega Saver package  |
| `@megasaver/policy`            | `@megasaver/shared`                                                      | core, output-filter, anything else |
| `@megasaver/output-filter`     | `@megasaver/shared`, `@megasaver/policy`                                 | `@megasaver/core` (§2e cycle)   |
| `@megasaver/content-store`     | `@megasaver/shared`, `@megasaver/output-filter` (OutputSourceKind type)  | `@megasaver/core`               |
| `@megasaver/retrieval`         | `@megasaver/shared`                                                      | policy, core                    |
| `@megasaver/stats`             | `@megasaver/shared`, `@megasaver/output-filter` (OutputSourceKind type)  | policy, core                    |
| `@megasaver/core`              | all packages above                                                       | mcp-bridge, apps                |
| `@megasaver/mcp-bridge`        | all packages above + core                                                | apps                            |

**Dep-graph tests (F-MIN-1).** Every new package (BB3, BB4, BB5,
BB6) ships
`packages/<name>/test/dependency-graph.test.ts` parsing its
`package.json` `dependencies` against the allow-list above. The
OO precedent in `apps/gui/bridge/` is the pattern. Package-level
cycles can slip through a `*.js` re-export chain that `pnpm
verify` typecheck alone won't catch; for a 5-new-package epic
the structural test is non-optional.
## §4 Session schema extension

The schema delta lands in `packages/core/src/session.ts`. The
new **settings** types live in `packages/core/src/token-saver.ts`
(BB1). The mode enum lives in
`packages/shared/src/token-saver-mode.ts` (BB1, §2e). The AA3
ordering pin for the mode lives in
`packages/shared/test/token-saver-mode.test-d.ts` (BB1).

### §4a Zod schema delta — mode in shared, settings in core

```ts
// packages/shared/src/token-saver-mode.ts (BB1, NEW)
import { z } from "zod";

// AA3 alphabetic. Members closed; aggressive < balanced < safe.
export const tokenSaverModeSchema = z.enum([
  "aggressive",
  "balanced",
  "safe",
]);
export type TokenSaverMode = z.infer<typeof tokenSaverModeSchema>;

export function modeToBudget(mode: TokenSaverMode): number {
  switch (mode) {
    case "aggressive": return 4_000;
    case "balanced":   return 12_000;
    case "safe":       return 32_000;
  }
}
```

```ts
// packages/core/src/token-saver.ts (BB1, NEW)
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

export const tokenSaverSettingsSchema = z
  .object({
    enabled: z.boolean(),
    mode: tokenSaverModeSchema,
    maxReturnedBytes: z.number().int().positive(),
    storeRawOutput: z.boolean(),
    redactSecrets: z.boolean(),
    autoRepair: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type TokenSaverSettings = z.infer<typeof tokenSaverSettingsSchema>;

export function defaultTokenSaverSettings(now: () => string): TokenSaverSettings {
  const stamp = now();
  return {
    enabled: false,
    mode: "balanced",
    maxReturnedBytes: 12_000,
    storeRawOutput: true,
    redactSecrets: true,
    autoRepair: true,
    createdAt: stamp,
    updatedAt: stamp,
  };
}
```

The `now: () => string` parameter is mandatory (no `Date.now()`
at module level — `CLAUDE.md` §8 boundary rule; matches the
`BridgeHandlerOptions.now` injection at
`apps/gui/bridge/handler.ts`).

### §4b `Session.tokenSaver` extension

`packages/core/src/session.ts` adds **one** field to the existing
`sessionSchema` object (existing fields untouched — the diff is
precisely additive):

```ts
import { tokenSaverSettingsSchema } from "./token-saver.js";

export const sessionSchema = z
  .object({
    id: sessionIdSchema,
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    riskLevel: riskLevelSchema,
    title: /* unchanged */,
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    tokenSaver: tokenSaverSettingsSchema.optional(),  // ← NEW
  })
  .strict();
```

### §4c Backward compatibility — hard rule

- Existing `sessions.json` records without `tokenSaver` parse
  fine: `optional()` means absent key → property undefined; the
  `.strict()` wrapper only rejects **unknown** keys, not missing
  optional ones. Confirmed against
  `packages/core/test/session.test.ts:51–60` parse-rejection
  patterns.
- The first time `mega session saver enable <id>` (BB2) runs on
  a pre-AA session, the registry method `updateTokenSaver()`
  (added in BB1, see §4d) writes the entire `TokenSaverSettings`
  object — there is no partial-state intermediate.
- Pre-AA sessions seen by AA-enabled binaries simply have
  `session.tokenSaver === undefined`; the GUI panel renders an
  "Enable Mega Saver Mode" CTA instead of stats.
- Migration is a no-op: no script, no version bump, no
  re-serialisation pass. The JSON directory store contract
  (`packages/core/src/json-directory-store.ts:85–93`) is
  untouched.
- **BB1 acceptance (Revision 2 — F-MED-5):** in addition to the
  Zod parse tests, BB1 ships a fixture-based test loading
  `packages/core/test/fixtures/sessions-v0.4.json` (a checked-in
  snapshot of a representative v0.4 `sessions.json` with two
  sessions, no `tokenSaver` field) and asserts roundtrip parse
  + `Session.tokenSaver === undefined` for every row.

### §4d Registry extension

`CoreRegistry` interface gains a single method in BB1:

```ts
updateTokenSaver(
  sessionId: SessionId,
  patch: TokenSaverSettings,         // full replacement, not partial
): Session;
```

Full-replacement (not partial `Pick<>`) is intentional. Plan
L478–L488 writes the whole object on enable; status/disable
mutations also write the whole object (no `Partial<>` reduction
risk). Mirrors `updateSession` shape at
`packages/core/src/registry.ts:101–113` but takes the entire
settings record rather than a patch.

### §4e Test-d pin locations (Revision 2 — split across two files)

- **Mode enum:** `packages/shared/test/token-saver-mode.test-d.ts`
  (NEW; AA3 pin for `TokenSaverMode`). Pattern source:
  `packages/mcp-bridge/test/transport.test-d.ts:29–32`.
- **Settings schema:** `packages/core/test/token-saver-settings.test.ts`
  (NEW; runtime parse + roundtrip; no closed-enum pin needed
  because all members are primitive booleans/numbers/strings).
- **Session schema regression:** `packages/core/test/session.test-d.ts`
  is no longer a NEW file — the AA3 pin moved out of core in
  Revision 2. BB1 still adds session-related regression tests but
  the file may not need a `.test-d.ts` suffix unless a closed
  enum lands locally; if not, the file simply doesn't exist.

---

## §5 CLI surface

The CLI is Citty-based per `apps/cli/src/cli.ts:1–4` →
`apps/cli/src/main.ts`. Existing patterns to mirror:

- Top-level subcommand registered in
  `apps/cli/src/commands/session/index.ts:34–43` style.
- Run-function shape with `cwd`, `home`, `xdgDataHome`,
  `stdout`, `stderr`, `json` plumbing —
  `apps/cli/src/commands/session/update.ts:16–28`.
- Failure-path drift guard — `apps/cli/test/json-failure-paths.test.ts`
  (BB2, BB7a, and BB7b must extend this file).

### §5a `mega session saver` (BB2)

```
mega session saver enable  <session-id> --mode safe|balanced|aggressive [--store <dir>] [--json]
mega session saver disable <session-id>                                  [--store <dir>] [--json]
mega session saver status  <session-id>                                  [--store <dir>] [--json]
mega session saver stats   <session-id>                                  [--store <dir>] [--json]
```

- `<session-id>` is positional, required, parsed through
  `sessionIdSchema` at the CLI boundary (mirrors
  `update.ts:43–49`).
- `--mode` is required for `enable`, rejected for the other
  three. Invalid mode → `invalidModeMessage()` (new sibling of
  `invalidRiskMessage` in `apps/cli/src/errors.ts`).
- `--store` overrides the resolved store directory (mirrors
  `update.ts:32–39`).
- `--json` parity: every write command MUST extend
  `apps/cli/test/json-failure-paths.test.ts` with entries for
  `saver enable invalid-mode`, `saver enable missing-mode`,
  `saver disable not-found`, etc.
- Exit codes: 0 success, 1 expected error (invalid input,
  not-found), 2 unexpected (re-thrown from
  `mapErrorToCliMessage`).
- Output: text mode prints one line summarising state (e.g.
  `Mega Saver Mode enabled for sess_abc (balanced; 12000 B)`);
  JSON mode prints a single line of
  `{ "sessionId": "...", "tokenSaver": { ... } }`.

### §5b `mega output` (split BB7a + BB7b — Revision 2)

```
mega output file    <session-id> --intent <s> <path>             [--store <dir>] [--json]   ← BB7a
mega output filter  <session-id> --intent <s> --file <log-path>  [--store <dir>] [--json]   ← BB7a
mega output chunk   <chunk-set-id> <chunk-id>                    [--store <dir>] [--json]   ← BB7a
mega output exec    <session-id> --intent <s> -- <cmd> [args...] [--store <dir>] [--json]   ← BB7b
```

Subcommand-to-sub-PR mapping is **strict**: `exec` is the only
subcommand that spawns a child process; it lands in BB7b at
CRITICAL risk. `file`, `filter`, `chunk` operate on on-disk
inputs; they land in BB7a at HIGH risk.

Shared contract across all four (file/filter/exec require
`--intent`; chunk doesn't):

- `--intent` REQUIRED for `file`, `filter`, `exec`. Refusal
  otherwise: `intent_required` error. Enforces the plan's
  intent-derivation contract (plan L792–L826) at the CLI
  boundary.
- **`exec` policy gate (BB7b only):** `child_process.spawn` is
  preceded by `policy.evaluateCommand({ command, args, project,
  env: { MEGASAVER_ORIGIN_PID: process.env.MEGASAVER_ORIGIN_PID
  ?? String(process.pid) } })`. Denial exits 1 with
  `command_denied: <reason>` text-mode message and a
  `details.reason: PolicyDenyCode` JSON-mode payload. The
  spawn ENV inherits `MEGASAVER_ORIGIN_PID` set to the root
  PID (Revision 2; F-CRIT-3, see §9a and §8d).
- **`file` path safety (BB7a):** path read goes through two
  gates in order — `policy.evaluatePathRead({ path, project })`
  (denylist of secret paths; BB3) then
  `outputFilter.resolveSafeReadPath({ path, projectRoot })`
  (sandbox gate: rejects symlink escapes, relative `..`
  traversal, absolute paths outside project root; BB5). Both
  must succeed before `fs.readFile`. If `evaluatePathRead`
  denies, exit 1 with `path_denied: <reason>` (PolicyDenyCode).
  If `resolveSafeReadPath` throws, exit 1 with `path_unsafe:
  <message>` (output-filter error, NOT a policy code; the
  sandbox gate is structural, not policy).
- `filter` is the no-spawn variant: take an existing log file
  and run it through the filter pipeline (useful for testing,
  for piping `pnpm test > log.txt && mega output filter ...`).
- `chunk` returns a single chunk from a previously stored
  chunk-set. No `--session-id` because `<chunk-set-id>` is
  globally unique; the content-store enforces ownership via
  the project/session embedded path (§10).

JSON shape per command, locked:

- `exec` / `file` / `filter` →
  `{ "sessionId": "...", "result": <FilterOutputResult> }`.
- `chunk` →
  `{ "chunkSetId": "...", "chunkId": "...", "chunk": <Chunk> }`.

### §5c `mega mcp` (BB8)

```
mega mcp install   --target <agent-id> [--json]
mega mcp repair    --target <agent-id> [--json]
mega mcp status                         [--json]
mega mcp uninstall --target <agent-id> [--json]
```

- `<agent-id>` validated against
  `apps/cli/src/known-targets.ts:21` (`KnownTargetId`); invalid
  → `unknown_target` error.
- `install` writes the agent's MCP config snippet idempotently
  (atomic write same pattern as
  `packages/core/src/json-directory-store.ts:235–286`).
- `repair` is `install` + `connector sync --target <id>` for
  the same agent — one call, two effects.
- `status` reports per-agent: `mcpInstalled`,
  `connectorSynced`, `restartRequired`.
- `uninstall` removes the MCP entry without touching the
  connector block (which the existing `connector` subcommand
  manages).

The plan's `mega doctor` (L546–L549) is **not** an AA-series
deliverable; an `apps/cli/src/commands/doctor.ts` file already
exists at v0.4 and remains the home for doctor logic. BB8/BB11
extend `doctor.ts` with token-saver-aware checks, not a new
`mega doctor` subcommand tree.

---

## §6 GUI surface

The GUI is React (Vite) with a Node `bridge` directory exposing
the HTTP loopback API. v0.4 split sessions into list/detail/view
per `apps/gui/src/views/sessions-{list,detail,view}.tsx`.

### §6a New views (BB11)

| View                                | Created by | Purpose                                       |
|-------------------------------------|------------|-----------------------------------------------|
| `views/agent-setup-doctor.tsx`      | BB11       | Doctor / repair driver; calls `/api/mcp/*`     |

(No new `sessions-*.tsx` files — the existing trio is extended,
not duplicated. The OO spec at
`docs/superpowers/specs/2026-05-10-oo-file-split-design.md:21–47`
locks the master/detail split shape.)

### §6b New components (BB10, BB11)

| Component                                       | Sub-PR | Embedded in                              |
|-------------------------------------------------|--------|------------------------------------------|
| `components/token-saver-panel.tsx`              | BB10   | `sessions-detail.tsx` (per-session pane) |
| `components/token-saver-modal.tsx`              | BB10   | Triggered from `token-saver-panel`       |
| `components/token-saver-stats.tsx`              | BB10   | Inside `token-saver-panel`               |
| `components/agent-setup-row.tsx`                | BB11   | Inside `agent-setup-doctor`              |
| `components/savings-badge.tsx`                  | BB10   | Sessions list row (compact savings %)    |

### §6c Bridge routes

| Method | Path                                                 | Handler file                       | PR   |
|--------|------------------------------------------------------|------------------------------------|------|
| POST   | `/api/sessions/:id/token-saver/enable`               | `bridge/routes/token-saver.ts`     | BB10 |
| POST   | `/api/sessions/:id/token-saver/disable`              | `bridge/routes/token-saver.ts`     | BB10 |
| GET    | `/api/sessions/:id/token-saver/status`               | `bridge/routes/token-saver.ts`     | BB10 |
| GET    | `/api/sessions/:id/token-saver/stats`                | `bridge/routes/token-saver.ts`     | BB10 |
| GET    | `/api/sessions/:id/token-saver/events`               | `bridge/routes/token-saver.ts`     | BB10 |
| GET    | `/api/sessions/:id/token-saver/events/:eventId/raw`  | `bridge/routes/token-saver.ts`     | BB10 |
| GET    | `/api/sessions/:id/token-saver/events/:eventId/sent` | `bridge/routes/token-saver.ts`     | BB10 |
| GET    | `/api/mcp/status`                                    | `bridge/routes/mcp-setup.ts`       | BB11 |
| POST   | `/api/mcp/install`                                   | `bridge/routes/mcp-setup.ts`       | BB11 |
| POST   | `/api/mcp/repair`                                    | `bridge/routes/mcp-setup.ts`       | BB11 |
| POST   | `/api/mcp/uninstall`                                 | `bridge/routes/mcp-setup.ts`       | BB11 |

Routes follow the existing handler pattern at
`apps/gui/bridge/routes/sessions.ts` (Zod-validated body, mapped
through `error-mapping.ts`, CORS by `cors.ts`).

The `/raw` and `/sent` event endpoints serve files from the
content-store path — they are deliberately separate URLs to keep
the JSON envelope small and to let the browser stream the blob.
Both endpoints set `content-type: text/plain; charset=utf-8` and
`content-disposition: inline`; CSP `default-src 'self'` is
preserved per `apps/gui/bridge/handler.ts:50` precedent.

### §6d Design-skill chain expectations

Per `CLAUDE.md` §5b and the LL precedent (LL spec §11): every
new view/component MUST traverse the design chain in a separate
context lane:

1. `huashu-design` for CONCEPT exploration.
2. `taste-skill` for the chosen direction.
3. `impeccable` for polish.
4. `design:design-critique` + `design:accessibility-review` in a
   separate context per `CLAUDE.md` §9.6 ("author != reviewer")
   before merge.

These passes are NOT additional sub-PRs; they are mandatory
checkpoints within BB10 and BB11.

---

## §7 Connector instruction block (CONTEXT_GATE)

**Lock: additive second sentinel pair.** Plan L666–L690 leaves
this ambiguous; the locked decision is:

```
<!-- MEGA SAVER:BEGIN -->         ← existing (untouched)
… session metadata, memory entries (current render shape) …
<!-- MEGA SAVER:END -->

<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->         ← NEW (BB11)
# Mega Saver Mode (Context Gate)
…rendered only when session.tokenSaver?.enabled === true …
<!-- MEGA SAVER:CONTEXT_GATE END -->
```

**Why additive, not nested or replacing:**

- The existing block at
  `packages/connectors/shared/src/render.ts:4–24` is parsed by
  `parseBlock()` (`parse.ts:15–47`) which scans for exactly one
  start + one end sentinel and surfaces zero/multiple as
  `ConnectorError("block_conflict")`. Nesting another sentinel
  pair inside the existing block would force a rewrite of
  `parseBlock` and break the byte-equality guarantee that
  `apps/cli/test/connector-byte-equality.test.ts` enforces.
- Replacing the existing block would break v0.4 sessions where
  the connector files already carry the legacy block — a v1.0
  migration.
- A second sentinel pair is independent: `parseBlock` is
  parameterised by a `(start, end)` tuple in BB11 (currently
  hard-coded in `parse.ts:17–18`); both blocks coexist; either
  can be absent.

**Constants** (added to
`packages/connectors/shared/src/constants.ts:1–2`):

```ts
export const MEGA_SAVER_BLOCK_START = "<!-- MEGA SAVER:BEGIN -->";
export const MEGA_SAVER_BLOCK_END   = "<!-- MEGA SAVER:END -->";
export const MEGA_SAVER_CG_BLOCK_START = "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->";
export const MEGA_SAVER_CG_BLOCK_END   = "<!-- MEGA SAVER:CONTEXT_GATE END -->";
```

**Which connectors write it.** All four known targets
(`apps/cli/src/known-targets.ts:12–17`): claude-code, codex,
cursor, aider. The renderer is **shared** in
`packages/connectors/shared/src/context-gate-block.ts` (new file
in BB11) — no agent-specific logic, per `CLAUDE.md` §1 ("Core is
agent-agnostic").

**Rendered content.** Tightened from plan L673–L690:

```markdown
<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->
# Mega Saver Mode

Mega Saver Mode is enabled for this session.

When reading large files, running commands, or inspecting build /
test output, prefer the Mega Saver MCP tools over native ones:

- `mega_read_file(path, intent, ...)` over reading a whole file.
- `mega_run_command(command, args, intent, ...)` over `Bash`.
- `mega_fetch_chunk(chunkSetId, chunkId)` to drill into a stored
  excerpt when the summary is insufficient.
- `mega_recall(sessionId, intent)` to reload session memory and
  recent tool calls without re-reading every file.

Always pass `intent` — it drives ranking. Raw output is stored
locally; ask for it only when the filtered result is genuinely
insufficient.

Session: <session-id>
Project: <project-id>
Mode: <safe|balanced|aggressive>
Max returned bytes: <number>
<!-- MEGA SAVER:CONTEXT_GATE END -->
```

**Rendering rule.** The renderer outputs the empty string when
`session.tokenSaver?.enabled !== true`. The `upsertBlock` helper
(`packages/connectors/shared/src/upsert.ts`) is extended in BB11
to handle two independent blocks: if a target file contained the
CG block and the session is now disabled, the block is **removed**
on the next sync. The existing `MEGA SAVER:BEGIN/END` block
remains untouched.

**Byte-equality guard.** A new test file
`packages/connectors/shared/test/context-gate-block.test.ts` must
pass before BB11 ships; existing
`apps/cli/test/connector-byte-equality.test.ts` is updated only if
the test asserts byte-equality across the FULL file (which it
does as of v0.4). The expected fixture inputs widen to include
enabled/disabled tokenSaver permutations.

---

## §8 MCP bridge real implementation

BB8 replaces the v0.3 placeholder at
`packages/mcp-bridge/src/bridge.ts:17–38` (the
`Promise.reject(McpBridgeError("not_implemented", ...))` returns).
Public API surface stays as locked in §2c.

### §8a Tool surface

Four MCP tools, alphabetic order (AA3 pin in
`packages/mcp-bridge/test/tool-name.test-d.ts`):

```ts
export const mcpToolNameSchema = z.enum([
  "mega_fetch_chunk",
  "mega_read_file",
  "mega_recall",
  "mega_run_command",
]);
```

| Tool name           | Input shape (Zod)                                            | Hits                                                                                       |
|---------------------|--------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| `mega_fetch_chunk`  | `{ chunkSetId, chunkId, around?: number }`                   | `@megasaver/content-store.loadChunkSet` + slice                                            |
| `mega_read_file`    | `{ path, intent, sessionId, maxBytes? }`                     | `policy.evaluatePathRead` → `outputFilter.resolveSafeReadPath` → `fs.readFile` → `filterOutput` → store |
| `mega_recall`       | `{ sessionId, intent, maxBytes? }`                           | `core.registry.listMemoryEntries` + chunkSets via `content-store`                          |
| `mega_run_command`  | `{ command, args, intent, sessionId, maxBytes? }`            | `policy.evaluateCommand` (with env marker) → spawn (env marker set) → `filterOutput` → store + stats |

`maxBytes` defaults to the session's
`tokenSaver.maxReturnedBytes` or `modeToBudget(mode)` if the
session has no override; explicit `maxBytes` MUST NOT exceed
`2 * modeToBudget("safe")` (64_000) as a hard ceiling.

**Path-read gate ordering (Revision 2; F-CRIT-2).** For
`mega_read_file`, the two gates run in strict order:
1. `policy.evaluatePathRead({ path, project })` — denylist
   check (the path matches a secret-path pattern such as
   `**/.env`, `**/.ssh/**`, `**/.aws/credentials`,
   `**/private_keys/**`). On `allowed: false` →
   `path_denied` with `details.reason: PolicyDenyCode`.
2. `outputFilter.resolveSafeReadPath({ path, projectRoot })` —
   sandbox structural check (rejects symlink-escape,
   `..`-traversal, absolute paths outside `projectRoot ∪
   cwd ∪ HOME`). On throw → `validation_failed` with the
   underlying message.
Both must succeed before `fs.readFile`.

### §8b Error code enum widening

`McpBridgeErrorCode` widens from `["not_implemented"]` to the
locked alphabetic set:

```ts
export const mcpBridgeErrorCodeSchema = z.enum([
  "auth_failed",
  "command_denied",
  "content_store_miss",
  "intent_required",
  "max_bytes_exceeded",
  "path_denied",
  "policy_load_failed",
  "redaction_failed",
  "resource_not_found",
  "session_not_found",
  "store_write_failed",
  "tool_invocation_failed",
  "tool_not_found",
  "transport_closed",
  "transport_failed",
  "validation_failed",
]);
```

Members rationale:

- `auth_failed` — reserved for `sse` transport; emitted by
  bearer-token verifier (v0.6+ wiring, but enum slot lands now
  to avoid a second schema bump).
- `command_denied` — `policy.evaluateCommand` returned
  `allowed: false`. Wire payload carries
  `details.reason: PolicyDenyCode`.
- `content_store_miss` — `mega_fetch_chunk` with unknown
  chunkSetId / chunkId.
- `intent_required` — caller omitted `intent`; surfaced before
  any IO.
- `max_bytes_exceeded` — caller asked for more than 64_000
  bytes (see §8a) or the unfiltered result exceeded the budget
  by > 10×.
- `path_denied` — `policy.evaluatePathRead` denied (Revision 2;
  new).
- `policy_load_failed` — `.megasaver/permissions.yaml`
  malformed (reserved for v0.9; enum slot now).
- `redaction_failed` — secret-detection regex threw
  (defensive).
- `resource_not_found` — MCP `resources/read` URI does not map
  to a known entity (Revision 2; F-MAJ-9: HH spec §7 reserved
  this; re-add).
- `session_not_found` — registry lookup returned null.
- `store_write_failed` — content-store or stats write threw.
- `tool_invocation_failed` — tool handler raised; `cause` set.
- `tool_not_found` — unknown name in `tools/call`.
- `transport_closed` — peer closed the stream.
- `transport_failed` — IO error on the wire.
- `validation_failed` — Zod input parse failed at the tool
  boundary (covers both tool-args parse and
  `resolveSafeReadPath` throw).

The v0.3 `not_implemented` member is **removed**, not kept as a
forwarding alias, per `CLAUDE.md` §13 (no pre-1.0
backward-compat shims). The placeholder test file at
`packages/mcp-bridge/test/errors.test-d.ts:5–30` is rewritten
end-to-end in BB8 to assert the new tuple in alphabetic order.

Tuple cardinality: 16 members (Revision 2 added `path_denied`
and `resource_not_found` vs Revision 1's 14).

### §8c Transport rollout

| Transport | v0.5 (BB8)                                            | v0.6 (post-epic) |
|-----------|-------------------------------------------------------|-------------------|
| `stdio`   | ships                                                 | unchanged         |
| `sse`     | enum present, factory rejects with `transport_failed` | implemented       |

`stdio` ships first because every supported agent (claude-code,
cursor, codex, aider) accepts an MCP server registered with a
launch command; `sse` is the multi-client follow-up per the HH
spec §5 already-locked plan. The closed enum keeps both members
so the schema does not bump twice.

### §8d Tool flow — `mega_run_command` (the critical path)

1. Validate input via `z.object({ command, args, intent,
   sessionId, maxBytes? })`. On fail → `validation_failed`.
2. Resolve session via `core.registry.getSession()`. On null →
   `session_not_found`.
3. **Compute env-marker (Revision 2; F-CRIT-3).**
   `parentMegaSaverPid = process.env.MEGASAVER_ORIGIN_PID`; if
   absent, the current MCP-bridge process is the root and sets
   `originPid = process.pid`. If present, this bridge was
   itself launched by a MegaSaver-orchestrated process —
   inherit the value.
4. `policy.evaluateCommand({ command, args, project:
   session.projectId, env: { MEGASAVER_ORIGIN_PID:
   originPid } })`. On `allowed: false` → `command_denied`
   with `details.reason: PolicyDenyCode`. The
   `recursive_megasaver` reason fires when
   `originPid !== process.pid` AND `originPid` is non-empty AND
   the parent has already issued an evaluate-command call within
   this process (heuristic — defeats agents that try to
   `mega_run_command -- mega output exec ...`).
5. `child_process.spawn(command, args, { stdio: ["ignore",
   "pipe", "pipe"], timeout: 5 * 60 * 1000, env: { ...process.env,
   MEGASAVER_ORIGIN_PID: originPid } })`. Combine stdout+stderr
   (preserve order via marker line). Cap total capture at
   `64 * maxBytes` (safety; raw is still bounded).
6. `policy.redact(rawText)`. On throw → `redaction_failed`.
7. `outputFilter.filterOutput({ raw: redactedText, intent, mode:
   session.tokenSaver?.mode ?? "balanced", maxReturnedBytes,
   sessionHints: contextHints(session), source: { kind:
   "command", command, args } })`.
8. `contentStore.saveChunkSet({ chunkSetId,
   projectId: session.projectId, sessionId, raw: redactedText,
   chunks, redacted: session.tokenSaver?.redactSecrets ?? true })`.
   On throw → `store_write_failed`.
9. `stats.appendEvent({ sessionId, projectId, sourceKind:
   "command", label, rawBytes, returnedBytes, bytesSaved,
   savingRatio, chunkSetId, summary, mode })` and
   `stats.updateSessionStats(sessionId, deltas)`.
10. Return `{ summary, excerpts, chunkSetId, rawBytes,
    returnedBytes, bytesSaved, savingRatio }` to the caller over
    the wire.

The orchestrator lives in
`packages/core/src/context-gate/run.ts`; the MCP tool is a thin
adapter that maps protocol args ↔ orchestrator args. The CLI
`mega output exec` (BB7b) calls the **same** orchestrator from
the other side — including the same env-marker computation in
step 3. This is the architectural payoff for keeping
context-gate inside core (§2a): one orchestrator, two entry
points (CLI + MCP), one re-entry detection mechanism.

---

## §9 Policy & redaction surface

`@megasaver/policy` is BB3 (HIGH risk).

### §9a Public API (Revision 2 — adds `evaluatePathRead`; drops `ProjectPermissions`)

```ts
// packages/policy/src/evaluate-command.ts
export type EvaluateCommandInput = {
  command: string;
  args: readonly string[];
  project: ProjectId;
  env?: {                                 // Revision 2 (F-CRIT-3)
    readonly MEGASAVER_ORIGIN_PID?: string;
  };
};
export type EvaluateCommandResult =
  | { allowed: true }
  | { allowed: false; reason: PolicyDenyCode };

export function evaluateCommand(input: EvaluateCommandInput): EvaluateCommandResult;

// packages/policy/src/evaluate-path-read.ts  (Revision 2 — NEW; F-CRIT-2)
export type EvaluatePathReadInput = {
  path: string;
  project: ProjectId;
};
export type EvaluatePathReadResult =
  | { allowed: true }
  | { allowed: false; reason: PolicyDenyCode };

export function evaluatePathRead(input: EvaluatePathReadInput): EvaluatePathReadResult;

// packages/policy/src/redact.ts
export type RedactResult = { redacted: string; count: number };

export function redact(text: string): RedactResult;

// packages/policy/src/deny-code.ts  (Revision 2: 6 members, +path_denied)
export const policyDenyCodeSchema = z.enum([
  "command_not_allowed",
  "dangerous_pattern",
  "intent_missing",
  "path_denied",
  "recursive_megasaver",
  "secret_path_read",
]);
export type PolicyDenyCode = z.infer<typeof policyDenyCodeSchema>;
```

**Removed in Revision 2.** `loadProjectPermissions` and the
`ProjectPermissions` type are NOT exported. Plan L1235–L1247
describes a v0.9 feature; the v0.5 spec surface for it
(half-implementation stub returning `null`) was rejected per
F-MED-4: pre-1.0 there is no consumer, and the BB3 ship surface
should not carry placeholders that drift. The v0.9 spec that
introduces the file will add the export. The
`policy_load_failed` MCP error code in §8b is reserved for that
day.

**`evaluatePathRead` denylist (Revision 2).** Default-deny
patterns checked in BB3 (case-insensitive glob):

- `**/.env`, `**/.env.*`
- `**/.ssh/**`
- `**/.aws/credentials`, `**/.aws/config`
- `**/.gcp/**`, `**/.azure/**`
- `**/private_keys/**`, `**/secrets/**`
- `**/id_rsa`, `**/id_ed25519`, `**/*.pem`, `**/*.key`
- `**/credentials.json`, `**/service-account*.json`

Deny → `{ allowed: false, reason: "secret_path_read" }` (or
`"path_denied"` if the denial is structural and not
secret-path-specific; BB3 spec picks the more precise reason).
The v0.9 permissions file overrides this denylist per-project
when it lands.

**`evaluateCommand` env-marker semantics (Revision 2).** When
`input.env?.MEGASAVER_ORIGIN_PID` is present and non-empty, the
gate consults a per-process re-entry counter:

- If `MEGASAVER_ORIGIN_PID === String(process.pid)`, the
  current process IS the root MegaSaver — no re-entry; pass.
- If `MEGASAVER_ORIGIN_PID !== String(process.pid)`, this
  process was launched by a MegaSaver-orchestrated parent.
  Deny with `recursive_megasaver`.

The check is a guard, not a tracker — it does not maintain
state across calls. Any inherited env marker means the caller
is downstream of MegaSaver and should not invoke MegaSaver
again.

### §9b Default ALLOWED_COMMANDS

Verbatim plan L1184–L1212 (alphabetised — plan order is not
alphabetic; BB3 sorts the constant for stable diffs):

```
bun, bunx, cargo, cat, deno, find, go, grep, jest, ls, make,
node, npm, npx, pnpm, pnpx, pwd, pytest, tail, ts-node, tsc,
tsx, vitest, wc, whoami, yarn
```

(Plan's `git` is removed because `mega_run_command` does **not**
need direct git invocation — diff-aware ranking in BB6 calls a
narrower `git diff --name-only` via a separate code path that
bypasses the allowlist with an in-process check. This avoids
the user surprise of "`git push` worked via Mega Saver but I
thought it was sandboxed". `git` re-enters the allowlist when /
if a v0.9 permissions file opts in.)

### §9c Default DANGEROUS_PATTERNS

Verbatim plan L1216–L1225 — denied even if the command is
allow-listed:

```
/rm\s+-rf\s+\//
/sudo/
/mkfs/
/shutdown/
/curl.+\|\s*sh/
/wget.+\|\s*sh/
/dd\s+if=/
/>\s*\/dev\/sd/
```

Patterns are matched against the **full** rendered command-line
string (`[command, ...args].join(" ")`), not individual
arguments — to catch `bash -c "rm -rf /"`.

### §9d Default REDACTION_PATTERNS

Plan L1253–L1267 names the categories. BB5 lands the exact
regexes (Zod-validated array of `{ name, pattern: RegExp,
replacement: string }` entries). At minimum:

| Name              | Pattern (sketch)                                       | Replacement                |
|-------------------|--------------------------------------------------------|----------------------------|
| github_token      | `gh[pousr]_[A-Za-z0-9]{36,}`                           | `gh*_[REDACTED]`           |
| openai_key        | `sk-[A-Za-z0-9]{20,}`                                  | `sk-[REDACTED]`            |
| anthropic_key     | `sk-ant-[A-Za-z0-9-_]{20,}`                            | `sk-ant-[REDACTED]`        |
| aws_access_key    | `AKIA[0-9A-Z]{16}`                                     | `AKIA[REDACTED]`           |
| aws_secret_key    | `(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}`   | `[REDACTED]`               |
| bearer_token      | `(?i:bearer\s+)[A-Za-z0-9\-._~+/=]{20,}`               | `Bearer [REDACTED]`        |
| jwt               | `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | `eyJ[REDACTED]`            |
| private_key_block | `-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END`   | `[REDACTED PRIVATE KEY]`   |
| env_value         | `(?<=^[A-Z_]+=)["'].+?["']`                            | `"[REDACTED]"`             |
| db_url            | `\b(?:postgres|postgresql|mysql|mongodb)://[^\s/]+:[^\s@]+@\S+` | `<scheme>://[REDACTED]@<host>` |

**BB5 test strategy (Revision 2; F-MED-1).** A property-based
test (fast-check) is necessary but insufficient. BB5 ships
**both**:

1. `packages/output-filter/test/redact.property.test.ts` —
   fast-check-generated inputs assert no recognised secret
   pattern survives `redact()`.
2. `packages/output-filter/test/redact-corpus.test.ts` — reads
   `packages/output-filter/test/fixtures/redaction/<name>/{input.txt,expected.txt}`
   pairs, asserts `redact(input).redacted === expected`. The
   corpus seed in BB5: one fixture per pattern name in the
   table above, plus three "negative" fixtures that look
   secret-shaped but shouldn't redact (e.g. `bearer` as a noun
   in prose).

Updates to the pattern list ship via changeset; new patterns
are LOW-risk PRs (not part of the AA epic) but their BB5 child
spec owns the corpus.

### §9e v0.9 permissions hook (reserved error code only)

The plan's `.megasaver/permissions.yaml` (L1235–L1247) is NOT
implemented in the AA epic and the BB3 surface no longer
carries a stub (F-MED-4). Only the MCP bridge's
`policy_load_failed` error code (§8b) is reserved for when the
v0.9 spec lands and starts parsing real files. No behaviour
change in v0.5; no half-implementation drift.

---

## §10 Content store surface

`@megasaver/content-store` is BB4 (MEDIUM risk).

### §10a On-disk layout

```
<store>/content/<projectId>/<sessionId>/<chunkSetId>.json
```

The `<store>` root is the same root resolved by
`packages/core/src/json-directory-store.ts:34–73`'s
`resolveStorePaths`. The `content-store` package is given the
resolved root path; it does NOT call `resolveStorePaths` itself
(§3 cycle guardrail — `content-store` MUST NOT import `core`).

### §10b Public API

```ts
export type ChunkSchema = z.infer<typeof chunkSchema>;
export type ChunkSetSchema = z.infer<typeof chunkSetSchema>;

export function saveChunkSet(input: {
  storeRoot: string;
  chunkSet: ChunkSet;
}): Promise<void>;

export function loadChunkSet(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
  chunkSetId: string;
}): Promise<ChunkSet>;  // throws ContentStoreError("not_found") on miss

export function listChunkSets(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
}): Promise<readonly ChunkSetSummary[]>;

export function deleteChunkSet(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
  chunkSetId: string;
}): Promise<void>;

export function pruneOlderThan(input: {
  storeRoot: string;
  olderThan: Date;  // callers pass explicit clock
}): Promise<{ removed: number }>;
```

`ContentStoreError` (Revision 2 explicit) carries
`ContentStoreErrorCode` (new closed enum, §17):

```ts
export const contentStoreErrorCodeSchema = z.enum([
  "not_found",
  "schema_invalid",
  "store_corrupt",
  "write_failed",
]);
```

AA3 alphabetic.

### §10c Atomic write — behavioral parity (Revision 2)

Atomic write is implemented inside `content-store` directly,
mirroring `json-directory-store.ts:235–286` semantics (POSIX
dir-fsync; Windows-aware via `process.platform === "win32"`
capture at module load). The duplication is bounded — ≈ 50 LOC.

Revision 1 proposed a source-byte-equality test
(`atomic-write-parity.test.ts` hashing both source files). That
test is brittle (any whitespace change in either file breaks
it; refactoring `json-directory-store.ts` would falsely fail
content-store's CI). **Revision 2 replaces it with a
behavioural parity test:** both implementations are run against
the same sequence of writes (success path, crash-during-rename,
crash-after-rename, dir-symlink-attack, parent-doesn't-exist)
and asserted to produce identical observable outcomes. The test
lives in `packages/content-store/test/atomic-write-behavior.test.ts`
and re-uses `packages/core`'s implementation via the public
`atomicWriteFile` if it gets exported (BB4 may add that
export); otherwise both implementations are imported as test
fixtures.

### §10d ChunkSet schema (Revision 2 — `redacted` invariant)

```ts
export const chunkSchema = z.object({
  id: z.string().min(1),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  text: z.string(),
}).strict();

export const chunkSetSchema = z.object({
  chunkSetId: z.string().min(1),
  sessionId: sessionIdSchema,
  projectId: projectIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("command"), command: z.string(), args: z.array(z.string()).readonly() }),
    z.object({ kind: z.literal("file"),    path: z.string() }),
    z.object({ kind: z.literal("grep"),    query: z.string() }),
    z.object({ kind: z.literal("fetch"),   url: z.string().url() }),
  ]),
  rawBytes: z.number().int().nonnegative(),
  redacted: z.boolean(),
  chunks: z.array(chunkSchema).readonly(),
}).strict();
```

The `source.kind` discriminator uses `OutputSourceKind` members
(§17) — the same closed enum that `output-filter` and `stats`
consume. BB4 imports `OutputSourceKind` from
`@megasaver/output-filter` (Revision 2: shared closed enum, not
local duplication).

**Redaction invariant (Revision 2; F-MAJ-3).** If the
originating session has `tokenSaver.redactSecrets === true`,
**every** persisted chunkSet for that session MUST have
`redacted: true`. The orchestrator at
`packages/core/src/context-gate/run.ts` enforces this: it runs
`policy.redact()` before `saveChunkSet()` and sets the flag
accordingly. If `redactSecrets === false`, the orchestrator
emits a warning into the `FilterOutputResult.warnings` array
("Session has redactSecrets disabled; raw output stored without
redaction") and `chunkSet.redacted = false`. BB4 ships an
acceptance test that load → save → load roundtrips preserve
the flag; BB5 ships an integration test asserting the
orchestrator never persists `redacted: false` when
`session.tokenSaver?.redactSecrets === true`.

### §10e Retention

Default: 7 days from `createdAt`. Daily prune at CLI startup if
the last prune was > 24h ago (lockfile pattern; BB4 ships the
stub; v0.8 GUI polish wires the user-visible control).

---

## §11 Output filter surface

`@megasaver/output-filter` is BB5 (HIGH risk).

### §11a `filterOutput` signature + Revision 2 additions

```ts
// packages/output-filter/src/output-source.ts (Revision 2 — NEW)
export const outputSourceKindSchema = z.enum([
  "command",
  "fetch",
  "file",
  "grep",
]);
export type OutputSourceKind = z.infer<typeof outputSourceKindSchema>;
```

`OutputSourceKind` is shared with `content-store` (§10d) and
`stats` (§13a) — see §17 for the cross-package ownership note.

```ts
// packages/output-filter/src/types.ts
import { tokenSaverModeSchema } from "@megasaver/shared";
import { riskLevelSchema } from "@megasaver/shared";

export const filterOutputInputSchema = z.object({
  raw: z.string(),
  intent: z.string().min(1).optional(),
  mode: tokenSaverModeSchema,                  // Revision 2: imports from @megasaver/shared
  maxReturnedBytes: z.number().int().positive().optional(),
  sessionHints: z.object({
    title: z.string().nullable().optional(),
    recentFiles: z.array(z.string()).readonly().optional(),
    recentMemory: z.array(z.string()).readonly().optional(),
    projectConventions: z.array(z.string()).readonly().optional(),
    risk: riskLevelSchema.optional(),
  }).optional(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("file"),    path: z.string() }),
    z.object({ kind: z.literal("command"), command: z.string(), args: z.array(z.string()).readonly() }),
    z.object({ kind: z.literal("grep"),    query: z.string() }),
    z.object({ kind: z.literal("fetch"),   url: z.string() }),
  ]).optional(),
}).strict();

export type FilterOutputInput = z.infer<typeof filterOutputInputSchema>;

export type FilterOutputResult = {
  summary: string;
  excerpts: readonly OutputExcerpt[];
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  savingRatio: number;          // 0..1
  chunkSetId?: string;          // set when content-store persisted
  warnings?: readonly string[]; // e.g., "redactSecrets disabled — raw stored unredacted"
};

export function filterOutput(input: FilterOutputInput): FilterOutputResult;
```

```ts
// packages/output-filter/src/resolve-safe-read-path.ts (Revision 2 — NEW; F-CRIT-2)
export type ResolveSafeReadPathInput = {
  path: string;
  projectRoot: string;          // absolute path, validated by caller
};
export type ResolvedPath = { absolute: string };

/**
 * Structural sandbox gate. Rejects:
 *   - symlink escapes (`fs.realpathSync` differs from joined path)
 *   - `..`-traversal escaping projectRoot
 *   - absolute paths outside { projectRoot, cwd, HOME }
 * Throws OutputFilterError("path_unsafe") on violation.
 */
export function resolveSafeReadPath(input: ResolveSafeReadPathInput): ResolvedPath;
```

`filterOutput` is **pure** (no IO). `resolveSafeReadPath` IS the
filesystem-touching helper but it is intentionally separate
from `filterOutput` — callers (BB7a `mega output file`, BB8
`mega_read_file`) compose the two. Persistence is the caller's
responsibility (the context-gate orchestrator at
`packages/core/src/context-gate/run.ts` calls `saveChunkSet`
after `filterOutput` returns; `chunkSetId` is generated by the
orchestrator and passed back into the result when present).

### §11b Pipeline order (locked)

The plan (L737–L747) sketches a stage list; BB5 locks the order:

1. **Redact** — `policy.redact(raw)` (count secrets removed;
   emit warning if `count > 0`).
2. **Normalize** — strip ANSI escapes, collapse `\r\n` → `\n`,
   trim trailing whitespace per line.
3. **Collapse repeated lines** —
   `Retrying connection... [repeated 4 times]`.
4. **Chunk** — default `chunkByLines(40)`; specialised parsers
   (test-output, ts-diagnostic, stacktrace) take precedence
   when their format is detected.
5. **Rank** — `scoreChunk(intent, chunk, sessionHints)` →
   `RankFeatures`-tagged `RankedChunk`.
6. **Dedupe** — drop near-duplicate chunks (Hamming-distance on
   normalised text; threshold pinned in BB5).
7. **Fit byte budget** — greedy pick by descending score until
   `returnedBytes <= maxReturnedBytes`.
8. **Summarize** — mode-dependent (safe → medium, balanced →
   short, aggressive → tiny). Deterministic templating, no LLM.
9. **Compose result** — bytesSaved = rawBytes - returnedBytes
   (clamped at 0); savingRatio = bytesSaved / rawBytes (0 when
   rawBytes === 0).

Redact-before-chunk (not after) is the **critical** ordering —
secrets MUST be removed before any persistence call (plan
L1248, §9 above). The redaction invariant in §10d depends on
this ordering.

### §11c `RankFeatureName` closed enum (AA3 pin)

```ts
export const rankFeatureNameSchema = z.enum([
  "diagnosticScore",
  "duplicatePenalty",
  "errorScore",
  "filePathScore",
  "keywordScore",
  "noisePenalty",
  "recentFileScore",
  "stackTraceScore",
  "testFailureScore",
]);
```

Alphabetic (AA3). `duplicatePenalty` and `noisePenalty` are
positive numbers subtracted in the scoring formula; their sign
is encoded by the formula, not the field name.

### §11d Mode → budget map (Revision 2 — sourced from `@megasaver/shared`)

`modeToBudget(mode)` lives in
`@megasaver/shared/src/token-saver-mode.ts` (§2e). `output-filter`
imports it via `@megasaver/shared`'s public export. The
function is the **single** source of truth for the mode →
byte-cap mapping across the entire codebase:

```
aggressive →  4_000
balanced   → 12_000
safe       → 32_000
```

If `maxReturnedBytes` is absent from the input, the filter uses
`modeToBudget(mode)`. If present, it overrides — but never
exceeds the §8a hard ceiling (`2 * modeToBudget("safe")`).

---

## §12 Retrieval surface

`@megasaver/retrieval` is BB6 (MEDIUM risk).

### §12a BM25 over chunked text

Standalone BM25 implementation (no external service per
`CLAUDE.md` §1 non-goal). Inputs are the chunked output text;
the index is constructed per-call (no persistent inverted index
for v0.5; performance is fine because chunk counts are < 1000
per call). v0.6+ may introduce a session-scoped index if
profiling shows hot loops.

### §12b `DerivedIntent` shape

```ts
export const derivedIntentSourceSchema = z.enum([
  "auto",
  "command",
  "explicit",
  "file-path",
  "recent-memory",
  "session-title",
]);
export type DerivedIntentSource = z.infer<typeof derivedIntentSourceSchema>;

export type DerivedIntent = {
  query: string;
  keywords: readonly string[];
  source: DerivedIntentSource;
};
```

AA3 alphabetic.

### §12c Intent derivation precedence (locked)

When the caller passes `intent: string`, source is `explicit`.
When `intent` is absent, the resolver walks this order and
stops at the first non-empty:

1. `explicit` — present in input.
2. `session-title` — `session.title` (NFC-normalised, see
   `packages/core/src/session.ts:15–20`).
3. `recent-memory` — most-recent N memory entries' `content`
   field (N = 3).
4. `command` — for `source.kind === "command"`, the command
   name + first arg.
5. `file-path` — for `source.kind === "file"`, the path
   basename minus extension.
6. `auto` — no signal; ranking degrades to noise-penalty /
   error-boost.

---

## §13 Stats surface

`@megasaver/stats` is BB6 (MEDIUM risk, alongside retrieval).

### §13a Types (Revision 2: `sourceKind` uses shared `OutputSourceKind`)

```ts
import { outputSourceKindSchema } from "@megasaver/output-filter";
import { tokenSaverModeSchema } from "@megasaver/shared";

export const tokenSaverEventSchema = z.object({
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  projectId: projectIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  sourceKind: outputSourceKindSchema,    // Revision 2: shared enum
  label: z.string(),
  rawBytes: z.number().int().nonnegative(),
  returnedBytes: z.number().int().nonnegative(),
  bytesSaved: z.number().int().nonnegative(),
  savingRatio: z.number().min(0).max(1),
  chunkSetId: z.string().min(1).optional(),
  summary: z.string(),
  mode: tokenSaverModeSchema,
}).strict();

export const sessionTokenSaverStatsSchema = z.object({
  sessionId: sessionIdSchema,
  eventsTotal: z.number().int().nonnegative(),
  rawBytesTotal: z.number().int().nonnegative(),
  returnedBytesTotal: z.number().int().nonnegative(),
  bytesSavedTotal: z.number().int().nonnegative(),
  savingRatio: z.number().min(0).max(1),
  secretsRedactedTotal: z.number().int().nonnegative(),
  chunksStoredTotal: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
```

Revision 2 removes the local `tokenSaverEventSourceKindSchema`
that Revision 1 declared — the shared `OutputSourceKind` from
output-filter is the single source of truth, used in three
places (filter input source, chunkSet source, event source).
The AA3 pin file for `OutputSourceKind` lives with the
declaration in `packages/output-filter/test/output-source.test-d.ts`.

### §13b On-disk layout

```
<store>/stats/<projectId>/<sessionId>.json          (session summary; one file)
<store>/stats/<projectId>/<sessionId>.events.jsonl  (append-only event log)
```

Session summary written atomically; events appended line-by-line
(crash-safe; JSONL parse rejects partial last line).

### §13c Reset semantics on disable

**Lock: preserve historical events; zero the session-summary
running totals.** When `mega session saver disable <id>` runs:

- `<sessionId>.events.jsonl` is **kept** (audit trail).
- `<sessionId>.json` (session summary) is rewritten with all
  totals zeroed and `updatedAt` set to now.

Justification: zeroing the summary mirrors the GUI mental model
("Mega Saver Mode: OFF, 0% saved"); keeping the events file
preserves evidence (plan principle #1 L1611–L1613). **Tentative
— revisit in BB6/BB10** (see §20b for the UX-angle brainstorm
that may flip this to "preserve summary, show lifetime
savings").

---

## §14 Sub-PR sequence

**Eleven sub-PRs, BB1 → BB11** (Revision 2: BB7 split into
BB7a + BB7b; BB9 reserved vacant per §19i to keep BB8 stable).
Each sub-PR carries its own child spec; the per-PR file lists
below name only the **unique-to-PR** surfaces (consult §3 for
the full workspace layout and §4–§13 for public APIs).

### BB1 — Session `tokenSaver` schema + `TokenSaverMode` hoist  (LOW–MEDIUM risk)

- **Adds:** `packages/shared/src/token-saver-mode.ts` (NEW;
  §4a), `packages/shared/test/token-saver-mode.test{,-d}.ts`
  (NEW, AA3 pin), `packages/core/src/token-saver.ts` (NEW;
  settings schema + default), `packages/core/test/fixtures/sessions-v0.4.json`
  (NEW, F-MED-5 fixture). Extends: `packages/core/src/{session,registry,index}.ts`,
  shared barrel, `packages/core/test/session.test.ts`.
- **Closed enum added:** `TokenSaverMode` in shared (§17).
- **Surface added:** `tokenSaverModeSchema`,
  `modeToBudget(mode)`, `tokenSaverSettingsSchema`,
  `defaultTokenSaverSettings(now)`, `Session.tokenSaver?`,
  `CoreRegistry.updateTokenSaver(sessionId, settings): Session`.
- **Backward compat:** existing `sessions.json` loads
  identically; pre-AA rows have `Session.tokenSaver ===
  undefined`.
- **Acceptance:** `pnpm verify` green; default-load + roundtrip
  + AA3 pin in shared + property test asserting strictly
  additive schema + **fixture roundtrip on
  `fixtures/sessions-v0.4.json`** (F-MED-5).
- **Depends on:** nothing (root). **Blocks:** BB2, BB5, BB6,
  BB7a, BB7b, BB8, BB10, BB11.

### BB2 — `mega session saver` CLI  (MEDIUM risk)

- **Adds:** `apps/cli/src/commands/session/saver/{enable,disable,status,stats,index}.ts`,
  `apps/cli/test/session/saver/*.test.ts`. Extends:
  `apps/cli/src/commands/session/index.ts`,
  `apps/cli/src/errors.ts` (`invalidModeMessage`),
  `apps/cli/test/json-failure-paths.test.ts`.
- **Surface added:** four subcommands per §5a; `--json` parity.
- **Acceptance:** enable/disable/status/stats end-to-end with
  CLI text + JSON output; JSON failure-path drift test green.
- **Depends on:** BB1. **Blocks:** BB10 (GUI consistency).

### BB3 — `@megasaver/policy` package  (HIGH risk — security gate)

- **Adds:** entire `packages/policy/` package (see §3a).
  Workspace + turbo refs.
- **Surface added:** `evaluateCommand` (with env-marker
  re-entry check — F-CRIT-3), `evaluatePathRead` (NEW, F-CRIT-2),
  `redact`, `policyDenyCodeSchema`. **NOT exported (F-MED-4):**
  `loadProjectPermissions`, `ProjectPermissions`. Defaults per
  §9b/c/d.
- **Closed enum added:** `PolicyDenyCode` (6 members per §9a).
- **Acceptance:** `evaluateCommand` rejects every L1216
  pattern; mismatched `MEGASAVER_ORIGIN_PID` returns
  `recursive_megasaver`; `evaluatePathRead` denies the default
  denylist; `redact` removes all default REDACTION_PATTERNS
  per §9d property test; dependency-graph test (policy → only
  shared).
- **Depends on:** BB1 (`ProjectId`). **Blocks:** BB5, BB7a,
  BB7b, BB8.
- **Risk:** HIGH — deny-list IS the contract; `architect` +
  `critic` adversarial review mandatory per `CLAUDE.md` §12.

### BB4 — `@megasaver/content-store` package  (MEDIUM risk)

- **Adds:** entire `packages/content-store/` package (see §3a).
- **Surface added:** §10b API; `ContentStoreError` +
  `ContentStoreErrorCode` enum (NEW, F-MAJ-4); behavioural
  atomic-write parity test (§10c).
- **Closed enum added:** `ContentStoreErrorCode` (4 members,
  AA3).
- **Acceptance:** roundtrip save/load/delete; missing chunkSet
  throws `not_found`; `pruneOlderThan` works; **redaction flag
  preserved (F-MAJ-3)**; behavioural parity vs core; dep-graph
  test.
- **Depends on:** BB1, BB5 partial (`OutputSourceKind` type;
  see §14-bis below for sequencing). **Blocks:** BB7a, BB7b,
  BB8.

### BB5 — `@megasaver/output-filter` package  (HIGH risk — redaction lives here)

- **Adds:** entire `packages/output-filter/` package (see §3a),
  plus `resolveSafeReadPath` (F-CRIT-2 sandbox gate) and
  `OutputSourceKind` (F-MAJ-4 shared discriminator).
- **Surface added:** `filterOutput`, chunkers, specialised
  parsers, `scoreChunk`, `RankFeatures`, `RankFeatureName`,
  `OutputSourceKind`, `resolveSafeReadPath`.
- **Closed enums added:** `RankFeatureName`, `OutputSourceKind`.
- **Acceptance:** large-input → small-result; error lines top;
  repeated lines collapsed; **property test + corpus test**
  (F-MED-1) prove no redaction-pattern survives;
  `resolveSafeReadPath` rejects symlink escapes + `..`-traversal
  + out-of-sandbox absolute paths; dep-graph test (output-filter
  → shared + policy only, NOT core).
- **Depends on:** BB1, BB3. **Blocks:** BB7a, BB7b, BB8. Also
  **patches BB4** in-PR to dedupe the `OutputSourceKind`
  placeholder (§14-bis).
- **Risk:** HIGH — secret-leakage failure mode;
  `security-reviewer` audit mandatory.

### BB6 — `@megasaver/retrieval` + `@megasaver/stats`  (MEDIUM risk)

- **Adds:** two new packages (see §3a), single PR.
- **Surface added:** §12 (retrieval) + §13 (stats). Stats
  `sourceKind` field type-imports `OutputSourceKind` from
  output-filter (F-MAJ-4; no local enum).
- **Closed enums added:** `DerivedIntentSource` (retrieval
  only).
- **Acceptance:** BM25 deterministic top-N; intent precedence
  per §12c; stats append + summary update roundtrip; disable
  preserves events + zeros summary per §13c; dep-graph tests
  for both packages.
- **Depends on:** BB1, BB5. **Blocks:** BB7a, BB7b, BB8, BB10.

### BB7a — `mega output {file,filter,chunk}` + orchestrator  (HIGH risk)

- **Adds:** `apps/cli/src/commands/output/{file,filter,chunk,index}.ts`,
  `packages/core/src/context-gate/{run,enable,disable,session-policy,context-hints,types,index}.ts`,
  `packages/core/src/context-gate.ts` (barrel),
  `apps/cli/test/output/*.test.ts`. Extends
  `apps/cli/test/json-failure-paths.test.ts`.
- **Surface added:** three `mega output` subcommands per §5b;
  `runContextGate` orchestrator (no spawn); `enableContextGate`
  + `disableContextGate` orchestrators (the latter called by
  BB2 once this lands).
- **Acceptance:** end-to-end `output file` writes raw chunkSet,
  prints filtered summary, updates stats; `evaluatePathRead`
  denials exit `path_denied`; `resolveSafeReadPath` rejects
  symlink escapes; `output chunk` returns a stored chunk;
  `output filter` runs on a log file.
- **Depends on:** BB1, BB3, BB4, BB5, BB6. **Blocks:** BB7b,
  BB8.
- **Risk:** HIGH — first user-visible exercise of the redaction
  pipeline (`output filter` reads potentially-secret-laden
  logs).

### BB7b — `mega output exec` + child-process spawn  (CRITICAL risk)

- **Adds:** `apps/cli/src/commands/output/exec.ts`,
  `packages/core/src/context-gate/run-command.ts` (spawn-
  specialised orchestrator),
  `apps/cli/test/output/exec.test.ts`,
  `apps/cli/test/output/exec.recursive.test.ts` (NEW; asserts
  inherited `MEGASAVER_ORIGIN_PID` triggers
  `recursive_megasaver`). Extends
  `apps/cli/src/commands/output/index.ts`,
  `apps/cli/test/json-failure-paths.test.ts`.
- **Surface added:** `mega output exec` (the only spawn
  subcommand); env-marker propagation contract.
- **Acceptance:** end-to-end `output exec -- pnpm test` writes
  chunkSet (with `redacted: true` when session has
  `redactSecrets: true` per F-MAJ-3); policy-denied command
  exits `command_denied`; recursive invocation detected via
  env marker; only spawn site in the output pipeline.
- **Depends on:** BB7a. **Blocks:** BB8.
- **Risk:** CRITICAL — first user-visible child-process spawn
  (F-MAJ-1). `tracer` + `security-reviewer` + manual user
  confirmation per §16. NO `autopilot` / `ralph`.
- **Post-merge audit (§2a deferred-extraction trigger).** Run
  `wc -l packages/core/src/context-gate/*.ts`; record in
  verifier-evidence bundle. If total > 500 LOC, queue BB12
  chore PR to extract `@megasaver/context-gate`.

### BB8 — `@megasaver/mcp-bridge` real implementation + `mega mcp` CLI  (CRITICAL risk)

- **Adds:** `packages/mcp-bridge/src/{server,tool-name}.ts`,
  `tools/{fetch-chunk,read-file,recall,run-command}.ts`,
  `setup/{install,repair,detect-agent}.ts`,
  `test/tool-name.test-d.ts`,
  `apps/cli/src/commands/mcp/*`. Replaces:
  `packages/mcp-bridge/src/bridge.ts`,
  `test/bridge.test.ts`, `test/errors.test-d.ts`.
- **Surface added/changed:** real `createBridge`, four MCP
  tools per §8a, `mega mcp install/repair/status/uninstall`;
  error enum widens to 16 members (§8b, F-MAJ-9).
- **Closed enums added/changed:** `McpToolName` (NEW),
  `McpBridgeErrorCode` (replaced).
- **Acceptance:** end-to-end claude-code → stdio → bridge →
  `mega_run_command` returns filtered response; policy-denied
  command receives `command_denied`; recursive
  `mega_run_command` (parent env marker present) returns
  `command_denied: recursive_megasaver`; unknown tool returns
  `tool_not_found`. Manual user confirmation per §16.
- **Depends on:** BB1, BB3, BB4, BB5, BB6, BB7a, BB7b.
  **Blocks:** BB11.
- **Risk:** CRITICAL — wire-protocol layer over the spawn
  surface; inherits BB7b chain.

### BB9 — RESERVED (intentionally vacant)

§19i locked the numbering policy: BB8 stays BB8 (keeps
cross-spec citations stable); BB9 is a vacant buffer; trailing
GUI PRs are BB10/BB11. No code, no spec, no risk row.

### BB10 — GUI TokenSaverPanel + bridge routes  (MEDIUM risk)

- **Adds:** `apps/gui/src/components/{token-saver-panel,token-saver-modal,token-saver-stats,savings-badge}.tsx`,
  `apps/gui/bridge/routes/token-saver.ts`,
  `apps/gui/test/**` (new test files). Extends
  `apps/gui/src/views/sessions-{detail,list}.tsx`,
  `apps/gui/bridge/{zod-schemas,handler}.ts` (handler stays ≤
  200 LOC per OO).
- **Surface added:** 7 bridge routes per §6c (token-saver
  half); React components per §6b.
- **Acceptance:** user enables mode from GUI; panel re-fetches
  and shows zeroed stats; CLI `output exec` runs update the
  panel on next refresh; `/raw` and `/sent` endpoints stream
  chunkSet content. `design:design-critique` +
  `design:accessibility-review` pass in fresh context.
- **Depends on:** BB1, BB2, BB4, BB5, BB6. **Blocks:** BB11.
- **Risk:** MEDIUM per LL precedent; design chain mandatory.

### BB11 — GUI AgentSetupDoctor + connector CONTEXT_GATE block  (MEDIUM risk)

- **Adds:** `apps/gui/src/views/agent-setup-doctor.tsx`,
  `apps/gui/src/components/agent-setup-row.tsx`,
  `apps/gui/bridge/routes/mcp-setup.ts`,
  `packages/connectors/shared/src/context-gate-block.ts`,
  `packages/connectors/shared/test/context-gate-block.test.ts`.
  Extends `packages/connectors/shared/src/{constants,upsert,parse}.ts`
  (parse parameterised by sentinel pair),
  `apps/cli/test/connector-byte-equality.test.ts` fixtures.
- **Surface added:** doctor view + 4 bridge routes per §6c
  (mcp half); additive CG sentinel renderer per §7.
- **Acceptance:** "Repair" on missing-config agent lands config
  + connector block; restart-required text per agent surfaces;
  byte-equality test green for all four enabled/disabled
  tokenSaver permutations.
- **Depends on:** BB8, BB10. **Blocks:** nothing inside the
  epic.
- **Risk:** MEDIUM — matches v0.2 connector rollout posture.

### §14-bis Sequencing note

BB4 type-imports `OutputSourceKind` from `@megasaver/output-filter`
(BB5). Clean ordering would be BB5-before-BB4, but the locked
choice is: **BB4 declares `OutputSourceKind` locally as a
placeholder; BB5 lands the canonical declaration and patches
BB4 in the same BB5 PR diff** to remove the local declaration.
One-PR-window of duplication; bounded; BB5 review verifies the
dedupe. Renumbering (swap BB4↔BB5) was rejected — would put
HIGH before MEDIUM and break risk pacing.

BB6 (`stats` → `OutputSourceKind`) lands after BB5; type is
canonical by then.
## §15 Risk modes per sub-PR

| PR    | Title (one-line)                                          | Risk     | Rationale                                                                                          |
|-------|-----------------------------------------------------------|----------|----------------------------------------------------------------------------------------------------|
| BB1   | Session `tokenSaver` + `TokenSaverMode` hoist             | LOW–MED  | Additive Zod field; closed enum in shared; backward-compat hard rule + fixture roundtrip           |
| BB2   | `mega session saver` CLI                                  | MEDIUM   | New write surface; default risk per `CLAUDE.md` §12                                                |
| BB3   | `@megasaver/policy` package                               | HIGH     | Security gate — deny-list IS the API contract; env-marker re-entry detection; path read denylist   |
| BB4   | `@megasaver/content-store` package                        | MEDIUM   | Persistence; atomic-write behavioural parity; redaction-flag invariant                             |
| BB5   | `@megasaver/output-filter` package                        | HIGH     | Secret redaction lives here; miss = data leak; corpus + property test mandatory                    |
| BB6   | `@megasaver/retrieval` + `@megasaver/stats`               | MEDIUM   | Pure compute + persistence; no security surface                                                    |
| BB7a  | `mega output {file,filter,chunk}` + orchestrator          | HIGH     | First user-visible surface that exercises the redaction pipeline; no spawn                         |
| BB7b  | `mega output exec` + child-process spawn                  | CRITICAL | First user-visible spawn surface (F-MAJ-1); env-marker re-entry; `CLAUDE.md` §12 CRITICAL          |
| BB8   | `@megasaver/mcp-bridge` real impl + `mega mcp`            | CRITICAL | Arbitrary command execution over MCP wire; inherits BB7b chain + wire-protocol layer               |
| BB9   | RESERVED (intentionally vacant; see §14)                  | —        | —                                                                                                  |
| BB10  | GUI TokenSaverPanel + bridge routes                       | MEDIUM   | Bridge extension; same posture as LL sessions routes                                               |
| BB11  | GUI AgentSetupDoctor + CG connector block                 | MEDIUM   | Connector surface change; matches v0.2 connector rollout posture                                   |

Risk levels per `CLAUDE.md` §12:

- LOW chain skipped only if BB1 code-reviewer agrees (default
  MEDIUM otherwise).
- HIGH PRs (BB3, BB5, BB7a) require `architect` design pass
  AND `critic` adversarial review in addition to standard
  chain. Worktree mandatory.
- CRITICAL PRs (BB7b, BB8) require HIGH chain PLUS `tracer`
  + `security-reviewer` + manual user confirmation per §16.
  NO `autopilot` / `ralph` / unsupervised loops. NO log
  compression (Mega Saver Mode CANNOT be enabled on the
  session that develops Mega Saver Mode itself — paradox guard,
  also enforced by the env-marker `recursive_megasaver` gate).

---

## §16 Multi-agent pipeline per sub-PR

For each risk level, the agent chain (per `CLAUDE.md` §4 + §5
+ §12) is:

**LOW / MEDIUM (BB1, BB2, BB4, BB6, BB10, BB11):**

1. `superpowers:brainstorming` → child spec.
2. `superpowers:writing-plans` → plan.
3. `superpowers:test-driven-development` → tests first.
4. `executor` (sonnet for MEDIUM, haiku-allowed for LOW
   refactors) implements.
5. `code-reviewer` (separate context) reviews.
6. `verifier` (separate context) confirms DoD §9.
7. Merge.

**HIGH (BB3, BB5, BB7a):**

1–7 above plus:

- `architect` (opus) concept exploration BEFORE child-spec
  brainstorm — "alternatives considered" memo.
- `critic` (opus) adversarial pass AFTER `executor`
  implementation, BEFORE `code-reviewer`.
- For BB5: `security-reviewer` audits the redaction patterns
  in a fresh context — explicit OWASP secret-detection
  checklist.

**CRITICAL (BB7b, BB8):**

1–7 above plus HIGH chain plus:

- `tracer` enumerates causal hypotheses on the spawn path
  (every branch that could spawn a child process or skip
  policy).
- `security-reviewer` produces a sign-off report — written as
  a PR comment.
- **Manual user confirmation artifact (Revision 2; F-MAJ-6).**
  The user confirms by replying `confirm <BB-id> merge`
  verbatim (e.g. `confirm BB7b merge` or `confirm BB8 merge`)
  to a chat message that links to:
  1. The verifier's evidence bundle (test output, exit codes,
     coverage diff).
  2. The security-reviewer's report (severity-rated findings,
     mitigation status).
  3. The tracer's hypothesis enumeration (what could go wrong,
     what's mitigated, what's accepted residual).
  4. The child-process whitelist verification (the exact list
     of `command` strings that successfully reached `spawn()`
     during integration testing — sanity check on
     ALLOWED_COMMANDS coverage).
- NO `autopilot` / `ralph` / unsupervised loops at any point.

**Author/reviewer collision rule (Revision 2; F-MAJ-5).** Each
BB-series child spec is authored in a **fresh `architect`
context** and reviewed in a **fresh `critic` context**. The
adversarial review of THIS spec (the AA1 epic) by a fresh
critic was performed in session UUID
`7fe20846-d614-40d6-908d-e0d8966fa679` per the parent's record.
No exceptions: no architect reviews their own spec; no critic
reviews a spec they authored. The constraint is enforced by
process discipline — there is no automated check — but every
verifier evidence bundle for a BB-series PR MUST include the
session UUIDs of (a) the architect that authored the child
spec, (b) the critic that adversarially reviewed it,
(c) the code-reviewer that approved the implementation. Three
distinct UUIDs, three distinct fresh contexts.

---

## §17 Closed-enum surfaces introduced across the epic

| Enum                            | Members (alphabetic, AA3)                                                                                                                              | Pinned in                                                              | Introduced by | Owner package                |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|------------------------------|
| `TokenSaverMode`                | `["aggressive", "balanced", "safe"]`                                                                                                                   | `packages/shared/test/token-saver-mode.test-d.ts`                      | BB1           | `@megasaver/shared` (§2e)    |
| `PolicyDenyCode`                | `["command_not_allowed", "dangerous_pattern", "intent_missing", "path_denied", "recursive_megasaver", "secret_path_read"]`                             | `packages/policy/test/deny-code.test-d.ts`                             | BB3           | `@megasaver/policy`          |
| `ContentStoreErrorCode`         | `["not_found", "schema_invalid", "store_corrupt", "write_failed"]`                                                                                     | `packages/content-store/test/error-code.test-d.ts`                     | BB4           | `@megasaver/content-store`   |
| `RankFeatureName`               | `["diagnosticScore", "duplicatePenalty", "errorScore", "filePathScore", "keywordScore", "noisePenalty", "recentFileScore", "stackTraceScore", "testFailureScore"]` | `packages/output-filter/test/rank-features.test-d.ts`                  | BB5           | `@megasaver/output-filter`   |
| `OutputSourceKind`              | `["command", "fetch", "file", "grep"]`                                                                                                                 | `packages/output-filter/test/output-source.test-d.ts`                  | BB5           | `@megasaver/output-filter` (consumed by content-store + stats) |
| `DerivedIntentSource`           | `["auto", "command", "explicit", "file-path", "recent-memory", "session-title"]`                                                                       | `packages/retrieval/test/intent.test-d.ts`                             | BB6           | `@megasaver/retrieval`       |
| `McpToolName`                   | `["mega_fetch_chunk", "mega_read_file", "mega_recall", "mega_run_command"]`                                                                            | `packages/mcp-bridge/test/tool-name.test-d.ts`                         | BB8           | `@megasaver/mcp-bridge`      |
| `McpBridgeErrorCode` (REPLACED) | 16 members (§8b)                                                                                                                                       | `packages/mcp-bridge/test/errors.test-d.ts` (rewritten)                | BB8           | `@megasaver/mcp-bridge`      |
| `McpTransport` (UNCHANGED)      | `["stdio", "sse"]` — launch-order                                                                                                                      | `packages/mcp-bridge/test/transport.test-d.ts` (unchanged)             | (no change)   | `@megasaver/mcp-bridge`      |

Total new tuple-ordering pin files in Revision 2: **7** (BB1 in
shared; BB3; BB4; BB5×2; BB6; BB8). One file rewritten
(`errors.test-d.ts` in BB8). One file unchanged
(`transport.test-d.ts`).

Revision-2 changes vs Revision 1:

- `TokenSaverMode` pin moved from
  `packages/core/test/session.test-d.ts` to
  `packages/shared/test/token-saver-mode.test-d.ts` (§2e).
- `PolicyDenyCode` gained one member `path_denied` (F-CRIT-2,
  6 members total).
- `ContentStoreErrorCode` added (F-MAJ-4).
- `OutputSourceKind` added as a shared enum (F-MAJ-4); the
  local `TokenSaverEventSourceKind` declared in Revision 1
  stats package is removed (§13a now imports from
  output-filter).
- `McpBridgeErrorCode` gained two members: `path_denied`
  (F-CRIT-2) and `resource_not_found` (F-MAJ-9 — restored from
  HH spec §7 reservation). Total 16 members.

`McpTransport` is grandfathered as launch-order per its
existing reasoning comment at
`packages/mcp-bridge/src/transport.ts:3–5`.

---

## §18 Conventions sync impact

`pnpm conventions:check` (JJ spec) runs in `pnpm verify` and
ensures `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, and
`CONVENTIONS.md` stay in sync with `docs/conventions/*.md`.

The AA epic touches conventions iff a new anti-pattern or
mandatory rule emerges. Locked decisions:

1. **BB3 adds an anti-pattern entry** to
   `docs/conventions/anti-patterns.md`: *"No `mega_run_command`
   call without policy gate. No path read in `mega_read_file`
   without `evaluatePathRead` + `resolveSafeReadPath`
   composition. No spawn without `MEGASAVER_ORIGIN_PID`
   propagation."* — same PR as the policy package itself.
   Mirrors land in `CLAUDE.md` §13, `AGENTS.md`, and
   `.cursor/rules/anti-patterns.mdc` via `pnpm conventions:sync`
   in the same commit.
2. **BB5 adds a rule** to
   `docs/conventions/code-conventions.md`: *"Redact before
   persist. Output filter pipeline order is redact → normalize
   → ... — do not reorder."*
3. **BB7b adds a rule** to
   `docs/conventions/process-discipline.md` (Revision 2 moves
   this from BB8): *"`mega output exec` and `mega_run_command`
   are CRITICAL per §12; never enable Mega Saver Mode on the
   session that develops it — paradox guard. The `recursive_
   megasaver` enum member exists to enforce this at runtime."*
   Same sync flow.
4. BB1, BB2, BB4, BB6, BB7a, BB8, BB10, BB11 do NOT touch
   conventions — additive code conforming to existing rules.

---

## §19 Alternatives considered

Twelve rejected options across Revision 1 (a–d) and Revision 2
(e–l). One-paragraph each — full reasoning lives at the spec
section cited in brackets.

### §19a `@megasaver/context-gate` as its own package — REJECTED (with deferred trigger)

Splitting an orchestrator that imports every domain package
guarantees a circular dep. Workspace bloat (5 scaffold files
× 5 packages) and re-export surface explosion seal the call.
**Revision-2 compromise [§2a]:** keep folded for BB1–BB7b;
post-BB7b LOC audit; extract to `@megasaver/context-gate` chore
PR (BB12) if total context-gate code > 500 LOC. Principle gets
a date with data.

### §19b `@megasaver/policy` deferred to v0.9 — REJECTED

Output-filter (BB5) must redact secrets before persist (plan
L1248); MCP bridge (BB8) must gate commands before spawn.
Deferring policy to v0.9 forces BB5 and BB8 to either hard-code
deny-lists (a half-implementation per `CLAUDE.md` §13) or
import from a not-yet-existing package. Promotion to BB3 is
cheap (one package, one public API). Unchanged from Revision 1.
[§2b, §9]

### §19c Connector sentinel — nested or replacing — REJECTED

Nesting forces a `parseBlock` rewrite and breaks the
byte-equality guarantee at
`apps/cli/test/connector-byte-equality.test.ts`. Replacing
breaks every v0.4 user. Additive second sentinel pair preserves
byte-equality, lets the two blocks evolve independently, and
needs only a sentinel-pair parameterisation of `parseBlock`.
Unchanged from Revision 1. [§7]

### §19d MCP bridge mid-series, not last — REJECTED

Plan MVP-7 placement is loose; BB7a+BB7b ship the orchestrator
and the spawn surface FIRST so BB8 is a thin wire-protocol
adapter rather than half a fresh implementation. The BB7 split
(F-MAJ-1) resolved the residual critic concern. [§14]

### §19e `TokenSaverMode` in `@megasaver/core` — REJECTED (Revision 2; F-CRIT-1)

Revision 1 located `tokenSaverModeSchema` + `modeToBudget` in
core and had `output-filter` import them from core. That
contradicted the cycle guardrail
("`@megasaver/output-filter` MUST NOT import `@megasaver/core`").
Resolution: hoist to `@megasaver/shared` (already the
dependency-root for `RiskLevel`, `AgentId`, IDs, `titleSchema`).
Both core and output-filter import from shared; cycle does not
close. [§2e, §4a]

### §19f Single `evaluatePathRead` covering denylist + sandbox — REJECTED (Revision 2; F-CRIT-2)

A single function would conflate two failure classes: per-project
policy denial (overridable by v0.9 permissions) vs structural
sandbox denial (never overridable — symlink escape is always a
bug). The sandbox check also performs filesystem IO
(`fs.realpathSync`), which doesn't belong in a pure-policy
package. Resolution: split into `policy.evaluatePathRead` (BB3,
denylist) + `outputFilter.resolveSafeReadPath` (BB5, sandbox).
Call sites compose them in order. [§5b, §8a, §9a, §11a]

### §19g `recursive_megasaver` with no detection mechanism — REJECTED (Revision 2; F-CRIT-3)

A deny-code with no detection input is a half-implementation per
`CLAUDE.md` §13. Resolution: `MEGASAVER_ORIGIN_PID` inherited
env marker (pnpm / npm / Yarn precedent). Root MegaSaver sets it
to its own PID; every spawn inherits it; `evaluateCommand`
denies when the inherited marker doesn't match the current
process PID. [§8d, §9a]

### §19h BB7 as single PR — REJECTED (Revision 2; F-MAJ-1)

Revision 1 lumped `exec`, `file`, `filter`, `chunk` together
at HIGH. But `exec` is the first user-visible child-process
spawn; CRITICAL per `CLAUDE.md` §12 belongs wherever spawn first
lands. Resolution: BB7a (HIGH, no spawn) + BB7b (CRITICAL,
spawn). BB7b inherits the full CRITICAL chain; BB8 keeps
CRITICAL for the wire-protocol layer. [§14, §15, §16]

### §19i Renumber post-BB8 — REJECTED (Revision 2)

Renumbering would force every cross-spec citation to "BB8 — the
MCP CRITICAL PR" to change. Keep BB8 stable; reserve BB9 as a
vacant numbering buffer; bump BB9→BB10 and BB10→BB11 only. Cost:
one vacant row in §15. [§14 BB9 row]

### §19j Source-byte parity for atomic-write — REJECTED (Revision 2; F-MIN-2)

Hashing source files and asserting equality is brittle
(whitespace breaks it; refactoring core falsely fails
content-store). Replaced with behavioural parity (same input
sequences → same observable outcomes). [§10c]

### §19k `loadProjectPermissions` stub in BB3 — REJECTED (Revision 2; F-MED-4)

Pre-1.0, the stub has no consumer and IS a half-implementation
per `CLAUDE.md` §13. The v0.9 spec that introduces
`.megasaver/permissions.yaml` adds the export. BB3 only reserves
the MCP error code `policy_load_failed`. [§9a, §9e]

### §19l `TokenSaverEventSourceKind` local to stats — REJECTED (Revision 2; F-MAJ-4)

The same four-member discriminator exists in `output-filter`
(filter input source) and `content-store` (chunkSet source).
Three local copies would drift. Promoted to a shared
`OutputSourceKind` in `@megasaver/output-filter` (§17
cross-package ownership), imported by content-store and stats.
[§10d, §11a, §13a, §17]
## §20 Open questions deferred to sub-PR specs

Genuinely under-specified items that this epic does NOT lock
because the data to decide does not yet exist. Each item names
the sub-PR that owns the brainstorm.

### §20a Diff-aware ranking — which git invocation (BB6)

Plan L1054–L1083 says MegaSaver should know recently edited
files but does not specify the git command, depth, or
non-git-repo behaviour.

Candidates: (1) `git diff --name-only HEAD`; (2)
`git log --since=24h --name-only`; (3) `fs.watch` cache.

Recommendation for BB6 brainstorm: ship (1); make
`recentFiles` an explicit caller-supplied input via
`filterOutput.sessionHints.recentFiles` so the ranking does
not depend on a git child-process at all in the hot path.

### §20b Stats reset semantics on disable (PARTIALLY LOCKED — §13c)

§13c locks "preserve events, zero summary" but the choice is
tentative. A UX brainstorm in BB6/BB10 may surface that users
want the GUI badge to show lifetime savings even after
disable. The BB10 design pass (`design:design-critique`) is the
forum to flip or confirm the decision.

### §20c Restart-required UX wording per agent (BB11)

Plan L1316–L1328 says GUI should display restart-required
clearly. Wording differs per agent:

- Claude Code: restart the CLI session (`exit && claude`).
- Cursor: reload IDE (`Cmd+Shift+P → Reload Window`).
- Codex: depends on the JetBrains-plugin vs standalone.
- Aider: re-launch (`aider`).

BB11 brainstorm: add a `restartHint: string` field to
`ConnectorTarget`. UX-copy review via `design:ux-copy`.

### §20d MCP bridge stdio multiplexing (BB8)

stdio is a one-stream wire format. Multiple agents → multiple
bridge processes or one shared daemon?

Recommendation for BB8 brainstorm: each agent launches its own
bridge process (`mega mcp install` writes the launch command
into the agent's config; the agent spawns the bridge as a child).
No shared daemon. `sse` (v0.6+) is the multi-client transport.

### §20e Post-BB7b context-gate package extraction trigger (BB7b/BB12)

§2a defers the `@megasaver/context-gate` extraction decision to
a post-BB7b audit. If the audit shows > 500 LOC across the
orchestrator, BB12 (a chore PR) extracts the package. The audit
itself is an acceptance criterion of BB7b (§14 BB7b row).

---

## §21 References

- **Plan source** —
  `../../MegaSaver_Context_Gate_Detailed_Plan.txt` (1777 lines).
- **CLAUDE.md** — §1 (mission), §2 (repo layout), §8 (code
  conventions, 300-LOC cap, Zod boundary), §9 (definition of
  done), §12 (risk modes), §13 (anti-patterns).
- **HH mcp-bridge placeholder spec** —
  `docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md`.
  §7 reserved `resource_not_found` for the widened enum
  (F-MAJ-9 honours this).
- **HH skill-packs spec** —
  `docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md`.
- **II GUI app spec** —
  `docs/superpowers/specs/2026-05-10-ii-gui-app-design.md`.
- **LL GUI v1 spec** —
  `docs/superpowers/specs/2026-05-10-ll-gui-v1-design.md`.
- **OO file-split spec** —
  `docs/superpowers/specs/2026-05-10-oo-file-split-design.md`.
- **JJ conventions-sync spec** —
  `docs/superpowers/specs/2026-05-10-jj-conventions-sync-design.md`.
- **AA3 schema-ordering convention** —
  `docs/superpowers/specs/2026-05-09-aa3-schema-ordering-design.md`.
- **Existing code surfaces:**
  - `packages/core/src/session.ts:9–39`
  - `packages/core/src/registry.ts:12–24`
  - `packages/core/src/json-directory-store.ts:235–286`
  - `packages/mcp-bridge/src/{bridge,transport,errors}.ts`
  - `packages/connectors/shared/src/{render,parse,constants}.ts`
  - `apps/cli/src/commands/session/update.ts:16–28`
  - `apps/gui/bridge/handler.ts`
  - `apps/cli/src/known-targets.ts:12–17`
  - `apps/cli/test/json-failure-paths.test.ts`
  - `packages/shared/src/index.ts` (extended by BB1)
- **Adversarial critic record** — session UUID
  `7fe20846-d614-40d6-908d-e0d8966fa679` (parent's record).

---

## §22 Confirmation — Revision-2 state matrix

Every section is locked. Revision-2 changes are tagged with the
critic finding ID. "Locked? (yes-Rev2)" means the lock changed
from Revision 1; "(yes)" means it carried forward unchanged.

| §       | Topic                                                  | State        | Revision-2 note                                              |
|---------|--------------------------------------------------------|--------------|--------------------------------------------------------------|
| §1      | Goal & non-goals + user-promise milestone              | yes-Rev2     | F-MAJ-10 milestone sentence at BB11                          |
| §2a     | Context-gate fold + deferred-extraction trigger        | yes-Rev2     | Critic compromise: BB7b post-merge LOC audit                 |
| §2b     | Policy promotion to BB3                                | yes          | Unchanged                                                    |
| §2c     | mcp-bridge extend, skill-packs untouched               | yes          | Unchanged                                                    |
| §2d     | Naming + identifier-scope split                        | yes-Rev2     | F-MED-3 orchestrator vs session-state names explicit         |
| §2e     | TokenSaverMode in `@megasaver/shared`                  | yes-Rev2     | F-CRIT-1 hoist; cycle closed                                 |
| §3      | Workspace layout + dependency graph                    | yes-Rev2     | Shared as root; dependency-graph tests now MANDATORY (F-MIN-1) |
| §4      | Session schema + BB1 fixture roundtrip                 | yes-Rev2     | F-MED-5 fixture test added                                   |
| §5a     | `mega session saver`                                   | yes          | Unchanged                                                    |
| §5b     | `mega output {file,filter,chunk,exec}` split           | yes-Rev2     | F-MAJ-1 BB7a/BB7b split                                      |
| §5c     | `mega mcp`                                             | yes          | Unchanged                                                    |
| §6      | GUI surface                                            | yes-Rev2     | PR numbers shifted BB9/BB10 → BB10/BB11                      |
| §7      | Connector CONTEXT_GATE block                           | yes-Rev2     | PR renamed BB10 → BB11                                       |
| §8a     | MCP tool surface + path-gate ordering                  | yes-Rev2     | F-CRIT-2 two-gate composition documented                     |
| §8b     | McpBridgeErrorCode (16 members)                        | yes-Rev2     | +`path_denied` (F-CRIT-2), +`resource_not_found` (F-MAJ-9)   |
| §8c     | Transport rollout                                      | yes          | Unchanged                                                    |
| §8d     | `mega_run_command` flow + env-marker                   | yes-Rev2     | F-CRIT-3 steps 3 + 5 explicit                                |
| §9a     | Policy public API                                      | yes-Rev2     | +`evaluatePathRead`, +`env?`, −`ProjectPermissions`           |
| §9b–§9d | Defaults                                               | yes          | Unchanged                                                    |
| §9e     | v0.9 permissions hook                                  | yes-Rev2     | F-MED-4 stub dropped; error code reserved only               |
| §10b    | content-store API + ContentStoreErrorCode              | yes-Rev2     | F-MAJ-4 new enum                                             |
| §10c    | Atomic-write parity                                    | yes-Rev2     | F-MIN-2 behavioural, not source-bytes                        |
| §10d    | ChunkSet + redaction invariant                         | yes-Rev2     | F-MAJ-3 redaction invariant                                  |
| §11a    | filterOutput + OutputSourceKind + resolveSafeReadPath  | yes-Rev2     | F-MAJ-4 + F-CRIT-2 new surfaces                              |
| §11b–§11d | Pipeline / RankFeatureName / modeToBudget            | yes-Rev2     | modeToBudget now sourced from shared (§2e)                   |
| §12     | Retrieval                                              | yes          | Unchanged                                                    |
| §13a    | Stats types (sourceKind from output-filter)            | yes-Rev2     | F-MAJ-4 local enum removed                                   |
| §13b    | Stats layout                                           | yes          | Unchanged                                                    |
| §13c    | Disable reset — tentative                              | yes-Rev2     | F-MED-2 "yes (tentative); see §20b"                          |
| §14     | Sub-PR sequence BB1–BB11 (11 PRs; BB9 reserved)        | yes-Rev2     | F-MAJ-1 split; §19i numbering policy                         |
| §15     | Risk modes (BB7a HIGH, BB7b CRITICAL, BB9 vacant)      | yes-Rev2     | F-MAJ-1                                                      |
| §16     | Multi-agent pipeline + collision rule + confirm artifact | yes-Rev2   | F-MAJ-5 + F-MAJ-6                                            |
| §17     | Closed-enum surfaces (9 enums, 7 new pin files)        | yes-Rev2     | +`ContentStoreErrorCode`, +`OutputSourceKind`, +2 in `McpBridgeErrorCode`, −`TokenSaverEventSourceKind` |
| §18     | Conventions sync impact                                | yes-Rev2     | BB8 rule moved to BB7b                                       |
| §19     | Alternatives considered (12 rows)                      | yes-Rev2     | 8 new from F-CRIT/F-MAJ/F-MED/F-MIN resolutions              |
| §20     | Open questions deferred (5 items)                      | yes-Rev2     | +§20e BB7b/BB12 extraction trigger                           |
| §21     | References + critic UUID                               | yes-Rev2     | Critic session UUID recorded                                 |

**Revision-2 blocker survey: zero remaining.** F-CRIT-1, F-CRIT-2,
F-CRIT-3, F-MAJ-1, F-MAJ-3, F-MAJ-4, F-MAJ-5, F-MAJ-6, F-MAJ-9,
F-MAJ-10, F-MED-1, F-MED-2, F-MED-3, F-MED-4, F-MED-5, F-MIN-1,
F-MIN-2 — all resolved in the spec body and recorded above. BB1
can dispatch.
