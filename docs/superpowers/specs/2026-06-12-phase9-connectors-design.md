---
title: Phase 9 — Multi-Agent Connectors — design
risk: HIGH
status: draft
created: 2026-06-12
updated: 2026-06-12
related:
  - docs/superpowers/specs/2026-05-09-cursor-connector-target-design.md
  - docs/superpowers/specs/2026-05-09-closed-enum-tripwire-design.md
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - wiki/syntheses/contextops-roadmap.md
  - wiki/entities/connectors-generic-cli.md
  - wiki/entities/connectors-claude-code.md
---

# Phase 9 — Multi-Agent Connectors — design

## §0 TL;DR

Phase 9 ("Multi-Agent Connectors") is **mostly already shipped.** The
connector subsystem — `ConnectorTarget`, `buildConnectorContext`,
`upsertBlock` sentinel rendering, the `mega connector sync` / `mega
connector status` commands, project-vs-session memory split, and four
working targets (`claude-code`, `codex`, `cursor`, `aider`) — landed
across v0.1 PRs and is the exact machinery the roadmap describes
(source: wiki/syntheses/contextops-roadmap.md:166-174). The roadmap's
exit criterion is *"same project memory shared across agents"*: a
decision recorded in one agent's session is recalled in another's
config file. The mechanism that makes that true **already exists** —
`buildConnectorContext` reads project-scoped memory from the shared
core registry and renders it into every target's file.

So Phase 9 is **not a new subsystem; it is a thin, additive widening of
the existing one** plus two missing commands and one missing proof. The
real gaps:

1. **Add a `gemini` connector target.** Widen `agentIdSchema` by one
   literal (`"gemini"`), ship a `geminiTarget` (writes `GEMINI.md`,
   generic-cli flat-file shape) from `@megasaver/connector-generic-cli`,
   and register it in the CLI's `KNOWN_TARGETS`. This is the canonical
   "new agent = new target object + agentId member" change (§3, §6).
2. **Add two config-file targets via the same pattern, no new sync
   code:** `windsurf` (`.windsurfrules`) and `continue`
   (`.continue/rules/megasaver.md`). Both are flat-file or
   seed-once-header targets that the existing `syncGenericCliTarget` /
   `upsertBlock` path already handles — adding them is *only* a target
   object + agentId member (§4).
3. **Add `mega connector list`** — enumerate known targets (id, agent,
   relative path, present/absent) without resolving memory (§5a).
4. **Add `mega connector doctor`** — per-target diagnostic: config file
   exists / writable / in-sync vs stale vs missing-block, with exact
   output lines and exit code (§5b).
5. **Prove the exit criterion** with a cross-agent shared-memory test:
   sync project memory to **two** agents (cursor + claude-code) and
   assert **both** files contain the same memory-derived content (§7).

**Deferred, explicitly out of scope:** `vscode` and `jetbrains` are
real IDE plugins (a VS Code extension, a JetBrains plugin), **not**
config-file memory sync — they cannot ride the `ConnectorTarget`
flat-file pattern and belong to a future native-plugin phase (§8). The
roadmap's `mega connect <agent>` ergonomic alias and folding connector
diagnostics into the global `mega doctor` are **also out of scope** in
favour of the least-churn `mega connector list` / `mega connector
doctor` subcommands on the existing group (§5c justifies).

The agentId enum widening is a **contract change**: every consumer of
`agentIdSchema` / `AgentId` — including two hardcoded enum mirrors and
one exhaustive `Record<AgentId, …>` — must be updated in lockstep or
`pnpm verify` fails. §6 enumerates every consumer.

Net-new = 3 target objects + 1 enum member (+ its full consumer
update) + 2 CLI subcommands + 1 cross-agent test. **No new package, no
new sync engine, no LLM, no change to `buildConnectorContext` or
`upsertBlock`.**

## §1 Motivation & philosophy — connectors are thin adapters; the engine already exists

Mega Saver's non-negotiable principle (CLAUDE.md §1): *Core is
agent-agnostic; agents connect to Mega Saver, never the reverse; every
connector is a thin adapter.* Phase 9's whole job is to demonstrate
that principle at scale — that adding the *N*th coding agent costs a
target object and an enum member, not a feature.

The subsystem already proves this for four agents. `buildConnectorContext`
(`apps/cli/src/commands/connector/shared.ts:45`) takes a target, a
project, all sessions, and all memory entries; picks the latest open
session **for that target's agent**; filters memory to
project-scoped + that-session-scoped entries; caps at 20 most-recent;
and returns a `ConnectorContext`. `syncGenericCliTarget` /
`upsertBlock` render that context into the target's file inside the
`MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END` sentinel pair,
preserving everything outside the block. The **project-scoped memory is
identical for every target** — that is the cross-agent shared-memory
mechanism, and it is already live.

Phase 9 therefore adds **agents, not capability.** The governing
constraints:

- **A new agent is data, not code.** Adding `gemini` / `windsurf` /
  `continue` means three frozen target objects and one enum literal.
  The sync loop in `runConnectorSync` iterates `KNOWN_TARGETS` and
  needs no per-agent branch (the cursor PR already generalised the
  seed path via the optional `header` field). If a proposed agent
  needs new sync code, it does **not** fit this phase (that is the
  `vscode`/`jetbrains` deferral, §8).
- **Reuse the rendering boundary verbatim.** No target gets a bespoke
  renderer. Every flat-file agent uses the same `upsertBlock` sentinel
  contract; the only per-target knobs are `relativePath` and the
  optional one-time `header` (used by cursor for `.mdc` frontmatter).
- **Diagnostics read, never write.** `mega connector list` and `mega
  connector doctor` are read-only reports (parity with `mega connector
  status`, which already computes drift without writing). `doctor`
  adds a *writability* probe but performs no mutation.
- **Prove the differentiator with a test, not prose.** The roadmap
  calls cross-agent shared memory "the real differentiator"
  (wiki/syntheses/contextops-roadmap.md:173). Phase 9 ships an
  integration test that makes it executable evidence (§7).

## §2 Reconciliation (the central design decision) — what exists vs what is new

Phase 9 heavily overlaps shipped code. The honest accounting,
target-by-target and command-by-command:

### §2a Target-by-target reconciliation table

| Target id | Agent file | Status | Source / package |
|-----------|-----------|--------|------------------|
| `claude-code` | `CLAUDE.md` | **EXISTS** — works | `@megasaver/connector-claude-code` (`CLAUDE_CODE_TARGET` lives in `apps/cli/src/known-targets.ts`) |
| `codex` | `AGENTS.md` | **EXISTS** — works | `codexTarget` in `@megasaver/connector-generic-cli` |
| `cursor` | `.cursor/rules/megasaver.mdc` | **EXISTS** — works (seed-once frontmatter `header`) | `cursorTarget` in `@megasaver/connector-generic-cli` |
| `aider` | `CONVENTIONS.md` | **EXISTS** — works | `aiderTarget` in `@megasaver/connector-generic-cli` |
| `gemini` | `GEMINI.md` | **NEW** (this phase) | new `geminiTarget`, generic-cli flat-file shape |
| `windsurf` | `.windsurfrules` | **NEW** (this phase) | new `windsurfTarget`, generic-cli flat-file shape |
| `continue` | `.continue/rules/megasaver.md` | **NEW** (this phase) | new `continueTarget`, generic-cli flat-file shape |
| `vscode` | (IDE extension) | **DEFERRED** — not a config-file target (§8) | — |
| `jetbrains` | (IDE plugin) | **DEFERRED** — not a config-file target (§8) | — |

The roadmap's stated connector order is
`claude-code/cursor/codex/gemini/windsurf/continue/vscode/jetbrains`.
The first four already ship; the next three are this phase's additive
targets; the last two are the deferral.

> **Conventions-sync collision check (mandatory — CLAUDE.md §7).** The
> `scripts/conventions-sync` system regenerates `CLAUDE.md`, `AGENTS.md`,
> and three `.cursor/rules/mega-*.mdc` files
> (`scripts/conventions-sync/src/manifest.ts` `CONSUMERS`). **None of the
> three new connector files collides:** `GEMINI.md`, `.windsurfrules`,
> and `.continue/rules/megasaver.md` are **not** conventions-sync
> consumers, so no managed block is touched and no drift guard fires.
> Note the cursor case is already disjoint by filename — the connector
> writes `.cursor/rules/megasaver.mdc` while conventions-sync writes
> `.cursor/rules/mega-context.mdc` / `mega-conventions.mdc` /
> `mega-discipline.mdc`. The new targets keep connector files and
> conventions mirrors distinct, as required. **`GEMINI.md` is a
> connector-only file; it is deliberately NOT added to the
> conventions-sync manifest** — it carries the rendered Mega Saver
> project/memory block, not the §1–§13 convention mirror, so there is
> nothing to reconcile.

### §2b Command-by-command reconciliation

| Command | Status | Notes |
|---------|--------|-------|
| `mega connector sync <project> [--target] [--json]` | **EXISTS** | writes the block into each target file; seeds missing files only with `--target` |
| `mega connector status <project> [--target] [--json]` | **EXISTS** | reports `missing` / `no-block` / `in-sync` / `drift` / `error`; exit 1 on any drift/error |
| `mega connector list [--json]` | **NEW** (§5a) | static enumeration of known targets; needs a project root only to resolve present/absent |
| `mega connector doctor <project> [--target] [--json]` | **NEW** (§5b) | per-target: exists / writable / in-sync vs stale; exit 1 on any non-OK |
| `mega connect <agent>` (roadmap alias) | **OUT OF SCOPE** (§5c) | prefer `list`/`doctor` on the existing group; renaming the group is churn for no capability |

### §2c What is reused unchanged vs what is new

- **Reused unchanged:** `ConnectorTarget` interface (the optional
  `header` field already covers cursor; no new field needed),
  `buildConnectorContext`, `pickLatestOpenSession`,
  `filterMemoryEntriesForSession`, `upsertBlock` / `parseBlock` /
  `renderBlock`, the sentinel constants, `syncGenericCliTarget`,
  `readTargetFile` / `writeTargetFile`, `runConnectorSync`'s loop,
  `runConnectorStatus`'s loop, `resolveProjectAndRoot`,
  `formatStatusLine`, `KNOWN_TARGETS` / `KNOWN_TARGET_IDS` /
  `isKnownTargetId`, the closed-enum-tripwire derivation pattern.
- **New (additive only):** one `agentIdSchema` literal (`"gemini"`) +
  its full consumer update (§6); three frozen target objects
  (`geminiTarget`, `windsurfTarget`, `continueTarget`) +
  re-exports + `builtinTargets` widening; their registration in the
  CLI's `KNOWN_TARGETS` (and the GUI bridge mirror); `mega connector
  list` and `mega connector doctor` (each a thin command +
  `run<Name>(input): Promise<0|1>`); the cross-agent shared-memory
  integration test. **Nothing existing changes behaviour** — the four
  shipped targets sync byte-identically.

## §3 The agentId enum widening — a contract change (`gemini`)

### §3a The change itself

`packages/shared/src/agent-id.ts` widens by **one** literal, inserted
**alphabetically** (the file's documented invariant: "Order:
alphabetic … Do not reorder"):

```ts
export const agentIdSchema = z.enum([
  "aider",
  "claude-code",
  "codex",
  "cursor",
  "gemini",
  "generic-cli",
]);
```

`gemini` sorts between `cursor` and `generic-cli`. `AgentId` widens
automatically. This is the **only** schema edit; `windsurf` and
`continue` (§4) likewise add one literal each, alphabetically:
`continue` between `codex` and `cursor`; `windsurf` between `gemini`
and `generic-cli` (final order:
`aider, claude-code, codex, continue, cursor, gemini, generic-cli,
windsurf`).

### §3b Why this is HIGH-risk, not trivial

The closed-enum-tripwire spec (2026-05-09) documents two CRITICAL
silent regressions (cursor PR #17, aider PR #21) where widening
`agentIdSchema` left a consumer-side mirror stale and `mega session
create --agent <typo>` lied to the user about valid agents. The
structural fix (derive from `agentIdSchema.options`) closed the CLI
`errors.ts` path, but **not every consumer is derived** — three are
hand-maintained mirrors or exhaustive maps that the compiler/tests
catch only if updated in lockstep (§6). This is precisely a
"public CLI flags / closed-set widening" change, which CLAUDE.md §12
classifies HIGH (pulls in `critic` adversarial review). The whole
point of Phase 9 is to make the *N*th-agent change safe and boring;
getting the consumer list complete is the work.

## §4 The two config-file targets — `windsurf` and `continue`

Both fit the generic-cli flat-file target shape exactly: a relative
path, a `MEGA_SAVER` block rendered by `upsertBlock`, everything
outside the block preserved. Neither needs new sync code; each is a
frozen target object + an `agentIdSchema` literal.

### §4a `windsurfTarget` → `.windsurfrules`

```ts
export const windsurfTarget = Object.freeze({
  id: "windsurf",
  agentId: "windsurf" satisfies AgentId,
  relativePath: ".windsurfrules",
});
```

**Config path rationale (assumption stated):** Windsurf reads a
project-root `.windsurfrules` plain-text/markdown file as its
project-level rules surface — the established single-file convention,
directly analogous to `CONVENTIONS.md` (aider) and `AGENTS.md`
(codex). Newer Windsurf builds also support a `.windsurf/rules/`
directory, but the single flat file `.windsurfrules` is the form that
fits the flat-file target shape with **no new sync code** and remains
read by current Windsurf. **Decision: `.windsurfrules`.** No header
(plain markdown; the block renders directly). Confidence: high.

### §4b `continueTarget` → `.continue/rules/megasaver.md`

```ts
export const continueTarget = Object.freeze({
  id: "continue",
  agentId: "continue" satisfies AgentId,
  relativePath: ".continue/rules/megasaver.md",
});
```

**Config path rationale (assumption stated, open question flagged).**
Continue's rules convention has shifted across versions. Two
candidates were considered:

1. `.continuerules` — a single project-root file (older single-file
   convention, exact analogue of `.windsurfrules`).
2. `.continue/rules/megasaver.md` — a per-rule markdown file under the
   `.continue/` workspace directory (the current, documented
   "rules blocks" convention).

**Decision: `.continue/rules/megasaver.md`** — it (a) matches
Continue's current documented `.continue/` workspace layout, (b)
namespaces our file (`megasaver.md`) so we never clobber a user's
other rule files, and (c) is still a flat markdown file the existing
`upsertBlock` path handles (the only consequence is that
`runConnectorSync`'s seed branch must `mkdir -p` the parent — which it
**already does** unconditionally via `mkdir(dirname(absPath), {
recursive: true })`, so this is genuinely zero new code, identical to
how cursor's `.cursor/rules/` parent is created). No header.

> **OPEN QUESTION (non-blocking, low):** Continue's rules path is the
> least settled of the three. If the implementer confirms (against the
> Continue version the project targets) that `.continuerules` is the
> canonical single-file form, switch `relativePath` to `.continuerules`
> and drop the directory nuance — the rest of the target object and
> every consumer update is identical. This is a one-line change with no
> ripple. The path choice does **not** block the enum/consumer work or
> the cross-agent proof; it only affects where `continue`'s file lands.
> Flagged rather than guessed wildly. `gemini` (`GEMINI.md`) and
> `windsurf` (`.windsurfrules`) are not in doubt.

### §4c Why these qualify and `vscode`/`jetbrains` do not

`gemini`/`windsurf`/`continue` are **CLI/editor agents that read a
project-local config file** — the same category as the four shipped
targets. A flat file + sentinel block is their native memory surface.
`vscode` and `jetbrains` are **IDE extension hosts**: their "memory"
surface is a plugin runtime (settings UI, extension API, language
server), not a checked-in rules file the connector can write. Forcing
them into the flat-file pattern would either (a) write a file the IDE
ignores or (b) require a real plugin — new sync code, new packaging, a
different phase. They are deferred in §8.

## §5 New commands — `mega connector list` and `mega connector doctor`

Both are added as **subcommands of the existing `connector` group**
(`apps/cli/src/commands/connector/index.ts`), alongside `sync` and
`status`. Each follows the shipped command shape: a
`run<Name>(input): Promise<0 | 1>` pure-ish core (stdout/stderr
injected), a citty `defineCommand` wrapper reading `readStoreEnv`, and
reuse of `resolveProjectAndRoot` / `KNOWN_TARGETS` / `formatStatusLine`.
No sync logic is duplicated.

### §5a `mega connector list [--json]`

Enumerates the CLI's known targets. Needs a project only to compute
present/absent (file existence under the project root); accepts the
same `<project>` positional + `--store` as `sync`/`status` for
consistency.

- **Per target, one line:** `<id padded>  <agent>  <relativePath>  <present|absent>`
  where `present` iff `readTargetFile(join(projectRoot, relativePath))
  !== null`. `agent` is `target.agentId` (equals `id` for all current
  targets, but printed explicitly to honour the "id, agent, path"
  contract).
- **Exit code:** always `0` — `list` is informational and never fails
  on absent files (absence is a valid, reported state).
- **`--json`:** array of
  `{ id, agent, relativePath, present: boolean }`.
- **Output example (eight targets, all absent in a fresh project):**

  ```
  claude-code  claude-code  CLAUDE.md                       absent
  codex        codex        AGENTS.md                        absent
  continue     continue     .continue/rules/megasaver.md     absent
  cursor       cursor       .cursor/rules/megasaver.mdc      absent
  gemini       gemini       GEMINI.md                        absent
  windsurf     windsurf     .windsurfrules                   absent
  aider        aider        CONVENTIONS.md                   absent
  ```

  (rows follow `KNOWN_TARGETS` launch order — `claude-code` first, then
  the generic-cli `builtinTargets` order; the example shows the
  post-Phase-9 set.)

### §5b `mega connector doctor <project> [--target] [--json]`

Per known target (or one, with `--target`), a diagnostic richer than
`status`: it answers **exists? writable? in sync with current project
memory, or stale?** It is `status` plus a *writability probe*, with a
doctor-shaped vocabulary.

- **Per-target status word (exactly one of):**
  - `ok` — file exists, contains a Mega Saver block, and
    `upsertBlock(existing, ctx)` is byte-equal to `existing` after EOL
    normalisation (i.e. **in sync** — same drift check `status` uses).
  - `stale` — file exists and has a block, but re-rendering would
    change it (project memory advanced since last sync). This is the
    "your config file is out of date; run `mega connector sync`" state.
  - `no-block` — file exists but has no Mega Saver sentinel pair (a
    user file the connector has never seeded).
  - `missing` — file does not exist (`readTargetFile` → `null`).
  - `not-writable` — file (or, when missing, its parent directory) is
    not writable. Probed by attempting an `access(path, W_OK)` on the
    file when it exists, else on the nearest existing ancestor
    directory; a probe failure yields `not-writable` and is **never** a
    silent write. This is the doctor-only signal `status` lacks.
  - `error` — an unexpected error reading/probing the target (mapped to
    a clean stderr line via `mapErrorToCliMessage`, parity with
    `status`).
- **Output line (text mode):**
  `<id padded>  <relativePath>  <status>  session=<id|none>`
  (identical column shape to `status`/`sync` via `formatStatusLine`,
  so the three commands' output aligns).
- **`--json`:** array of
  `{ id, relativePath, status, writable: boolean, session: string | null }`.
- **Exit code:** `0` iff **every** reported target is `ok` *or*
  `missing` *or* `no-block` (states that are not in themselves a
  defect — a fresh project legitimately has no files). `1` if **any**
  target is `stale`, `not-writable`, or `error`. Rationale: `stale`
  means recorded memory is not reflected in the agent file (the exact
  failure Phase 9 exists to prevent); `not-writable` means a sync would
  fail; both are actionable defects worth a non-zero exit so CI / `&&`
  chains catch them. `missing`/`no-block` are benign (the user simply
  hasn't opted that agent in), so they do not fail the command. This
  mirrors `status`'s "exit 1 on any drift/error" but adds the
  writability dimension.
- **Output example (gemini synced & current, cursor stale, windsurf
  file present but read-only, aider never seeded):**

  ```
  gemini       GEMINI.md                        ok        session=none
  cursor       .cursor/rules/megasaver.mdc      stale     session=2f3c…
  windsurf     .windsurfrules                   not-writable  session=none
  aider        CONVENTIONS.md                   missing   session=none
  ```

  exit code `1` (cursor `stale` + windsurf `not-writable`).

### §5c `mega connect` vs `mega connector` — least-churn decision

The roadmap names a `mega connect <agent>` ergonomic command. **We do
not add it.** Justification:

1. **No new capability.** Everything `mega connect <agent>` would do
   (sync/seed one agent) is already `mega connector sync <project>
   --target <agent>`. An alias is pure ergonomics.
2. **A rename is churn against a stable surface.** `mega connector` is
   the shipped group with three (soon four) subcommands, tests pinning
   its output, and a wiki entity documenting it. Renaming to `mega
   connect` (or aliasing) means dual command registration, dual help
   text, and either duplicated or forwarded logic — exactly the
   "duplicate sync logic" the task forbids.
3. **`list` + `doctor` deliver the roadmap's intent.** The roadmap's
   Phase 9 verbs are *connect / list / doctor*. We satisfy *list* and
   *doctor* as subcommands of the existing group and treat *connect* as
   already-covered by `sync --target`. The ergonomic top-level alias
   can be a trivial post-MVP follow-up if demand appears; it is not a
   capability gap.

**Decision: add `list` and `doctor` to the existing `connector` group;
treat the `mega connect` rename/alias as out of scope (§8).**

## §6 Every consumer the agentId widening touches (the contract surface)

Adding `gemini` (and `windsurf` / `continue`) to `agentIdSchema` is a
contract change. Every consumer below must be updated **in the same
PR** or `pnpm verify` (typecheck or test) fails. Consumers split into
three classes: **(A) derived** (pick the change up automatically — no
edit, but a test may pin the count), **(B) exhaustive type maps**
(typecheck error until updated), **(C) hardcoded mirrors / pinned
assertions** (test failure until updated).

### §6a Class A — derived, auto-updating (verify but do not hand-edit the value)

| Consumer | File | Why it is safe |
|----------|------|----------------|
| `sessionSchema.agentId`, `sessionUpdatePatchSchema.agentId` | `packages/core/src/session.ts` | uses `agentIdSchema` directly — widens automatically |
| `ConnectorContextSchema.agentId` | `packages/connectors/shared/src/context.ts` | uses `agentIdSchema` directly |
| CLI `invalidAgentMessage` valid-agent list | `apps/cli/src/errors.ts` | derives from `agentIdSchema.options` (post-tripwire) — auto |
| session-schema property test generators | `packages/core/test/session-schema.property.test.ts` | spreads `agentIdSchema.options` into `fc.constantFrom` — auto |
| GUI bridge session bodies | `apps/gui/bridge/zod-schemas.ts` | `CREATE_SESSION_BODY`/`PATCH_SESSION_BODY` use `agentIdSchema` — auto |

### §6b Class B — exhaustive type maps (typecheck FAILS until updated)

| Consumer | File | Required edit |
|----------|------|---------------|
| `AGENT_LABEL: Record<AgentId, string>` | `apps/gui/src/components/badges.tsx` | **add a key per new agent** (`gemini`, `windsurf`, `continue`) → short label, e.g. `gemini: "gemini"`, `windsurf: "windsurf"`, `continue: "continue"`. Missing key = `tsc` error. |

> No exhaustive `switch (agentId)` over `agentIdSchema` exists in the
> codebase outside this map. The mcp-bridge `detectAgent` switch is
> over the **separate** `knownAgentIdSchema` (§6d) and is **not**
> touched by this change.

### §6c Class C — hardcoded mirrors / pinned assertions (test FAILS until updated)

| Consumer | File | Required edit |
|----------|------|---------------|
| `members` array + `toHaveLength(5)` + `.options` order assertion | `packages/shared/test/agent-id.test.ts` | extend `members`, bump length to the new count, update the `.options` ordered tuple, add an explicit `parse("gemini")` (and windsurf/continue) assertion. **This is the drift guard the tripwire spec relies on — hand-updated on purpose.** |
| `.options` ordered-tuple type test | `packages/shared/test/agent-id.test-d.ts` | update the `readonly [...]` tuple to the new ordered members; add the new literals to the assignable-member test |
| `AGENT_IDS` hardcoded tuple (dropdown source) | `apps/gui/src/components/session-forms.tsx` | append the new literals (alphabetical) — this is a literal mirror, not derived |
| dropdown options assertion | `apps/gui/test/components/session-forms.test.tsx` | update the expected `options` array to the new ordered set |
| GUI badges test | `apps/gui/test/components/badges.test.tsx` | add a render assertion per new agent label (parity with the existing per-agent tests) |

### §6d Explicitly NOT touched (separate enum — scope boundary)

The **`knownAgentIdSchema`** (`packages/mcp-bridge/src/setup/agent-ids.ts`
= `["claude-code","codex","cursor","aider"]`) and its exhaustive
`detectAgent` switch (`packages/mcp-bridge/src/setup/detect-agent.ts`)
are the **MCP-install** surface — the agents that can host the Mega
Saver MCP server. This is a **deliberately narrower set** than
`agentIdSchema` (the connector-target set). The new agents
(`gemini`/`windsurf`/`continue`) are **connector-sync targets only,
not MCP-install targets** this phase — exactly as the connector set has
always been wider than the MCP set. Therefore `knownAgentIdSchema`,
`detectAgent`, and the GUI's `MEGA_MCP_*_BODY` (which validate against
`knownAgentIdSchema`) are **unchanged**. Adding MCP-server support for
the new agents is a separate, out-of-scope decision (§8). Documenting
this boundary is itself part of the reconciliation: the two enums must
not be conflated.

### §6e The known-targets registries (target registration, not the enum)

Separately from the enum, the new **target objects** must be registered
in the two `KNOWN_TARGETS` registries (these are the connector-target
source-of-truth, not enum mirrors):

| Registry | File | Edit |
|----------|------|------|
| CLI known targets | `apps/cli/src/known-targets.ts` | import + append `geminiTarget`, `windsurfTarget`, `continueTarget` to `KNOWN_TARGETS` |
| GUI bridge mirror | `apps/gui/bridge/known-targets.ts` | same import + append (the file's comment already says "Keep in sync with the CLI list") |

`KNOWN_TARGET_IDS`, `KnownTargetId`, `isKnownTargetId`,
`TARGET_ID_COLUMN_WIDTH`, the `sync`/`status` loops, `list`, and
`doctor` all derive from `KNOWN_TARGETS` and pick the new targets up
automatically once registered (the tripwire-spec payoff).

## §7 The exit-criterion proof — cross-agent shared memory (integration test)

The roadmap exit is *"same project memory shared across agents."* Phase
9 makes it executable: an integration test (`apps/cli`, alongside the
existing connector tests) that syncs one project's **project-scoped**
memory to **two** agents and asserts **both** files carry the same
memory-derived content.

**Test shape (cursor + claude-code — two distinct packages, two
distinct file formats, to prove the sharing is real and not an
artifact of one renderer):**

1. Seed a store with one project (rootPath = a temp dir) and one
   **project-scoped** memory entry with distinctive content, e.g.
   `"AUTH BUG: the login token is double-encoded"`.
2. Run `runConnectorSync({ projectName, target: "claude-code", … })`
   then `runConnectorSync({ projectName, target: "cursor", … })`
   (seeding both files via `--target`).
3. Read both files:
   - `join(projectRoot, "CLAUDE.md")`
   - `join(projectRoot, ".cursor/rules/megasaver.mdc")`
4. **Assert both contain the memory content** (`expect(claudeMd).toContain("AUTH BUG: the login token is double-encoded")`
   and the same for the cursor file) — the literal decision recorded in
   one place surfaces in *both* agents' config.
5. **Assert the shared block is byte-identical between the two files**
   *inside the sentinel pair*: extract the `MEGA_SAVER_BLOCK_START …
   MEGA_SAVER_BLOCK_END` span from each via `parseBlock` and assert the
   two block bodies are equal (cursor's frontmatter lives *outside* the
   block, so the block bodies match exactly). This proves the
   cross-agent content is the **same rendered memory**, not two
   coincidentally-overlapping strings.

This is the concrete realisation of "a decision made in Cursor is
recalled in Claude Code" — here the decision is project memory, and the
test proves it lands identically in both agents' files. The test uses
the **shipped** `buildConnectorContext` path unchanged; it is a proof
of the existing mechanism extended to the widened target set, not new
behaviour. (A second, lighter assertion may pair `gemini` +
`claude-code` to prove a *new* target participates in the shared-memory
guarantee.)

## §8 Out of scope (explicit)

- **`vscode` (VS Code extension) and `jetbrains` (JetBrains plugin).**
  These are native IDE plugins, **not** config-file memory sync. They
  do not fit the `ConnectorTarget` flat-file pattern (their memory
  surface is a plugin runtime, not a checked-in rules file), require
  new sync/packaging code, and belong to a future native-plugin phase.
  Listed in the roadmap order but explicitly deferred here (§4c).
- **`mega connect <agent>` top-level ergonomic command / renaming the
  `connector` group.** Pure ergonomics over the existing `sync
  --target`; renaming is churn against a stable, tested surface (§5c).
  `list` + `doctor` deliver the roadmap's *list/doctor* intent.
- **Folding connector diagnostics into the global `mega doctor`.** The
  global `mega doctor` is env-only (node/platform/cwd) and resolves no
  project/store; connector diagnostics need a project. Keeping them in
  `mega connector doctor` avoids coupling the env check to store
  resolution. (If a future phase wants a one-shot "everything" doctor,
  it can call the connector doctor's `run` and merge — no rework.)
- **MCP-server support for the new agents** (adding `gemini`/`windsurf`/
  `continue` to `knownAgentIdSchema` / `detectAgent`). The
  connector-target set is intentionally wider than the MCP-install set
  (§6d); extending MCP support is a separate decision.
- **A real Continue/Windsurf rules-format study** beyond the documented
  single-file/`.continue/` conventions used here (§4); the path choice
  is isolated to `relativePath` and is the one flagged open question
  (§4b).
- **Changing `buildConnectorContext`, the 20-entry cap, the memory
  filter, or `upsertBlock`** — the rendering and selection are reused
  verbatim; no behaviour change to the four shipped targets.
- **Phase 10 team/cloud connectors** (shared/team memory, approval,
  cloud sync) — a different phase.

## §9 Risk

**HIGH.** Phase 9 touches a **public CLI surface** (two new commands +
help text), a **closed-set enum widening** (the exact change that
produced two prior CRITICAL silent regressions), and **user files at
scale** (it writes config files into the user's repo for three new
agents). CLAUDE.md §12 classifies public-flag + connector-core-path +
enum-widening work as HIGH (pulls in `critic` adversarial review). Main
risks + mitigations:

1. **Stale enum mirror (the recurring CRITICAL).** A consumer in §6b/§6c
   not updated → a typecheck error (caught by `tsc`) or a lying
   user-facing list (caught by the pinned `agent-id.test.ts` /
   dropdown-options assertion). Mitigated by §6's complete consumer
   enumeration + the hand-maintained drift-guard tests being part of the
   same PR; `critic` re-runs the closed-enum sweep.
2. **A new target accidentally diverging the rendered block.** A target
   with a stray `header` or wrong path could write a file the agent
   ignores or a block that differs from the others. Mitigated by the
   cross-agent test (§7) asserting block-body byte-equality across two
   targets, and by reusing `upsertBlock` unchanged.
3. **`doctor` writability probe causing a write.** A buggy probe could
   create/modify a file. Mitigated by probing with `access(…, W_OK)`
   only (no `open` for write, no `mkdir`); the doctor test asserts the
   probed file is **not** created/modified.
4. **Conventions-sync collision.** A new connector file shadowing a
   managed convention mirror → drift-check failure or clobbered user
   content. Mitigated by the §2a collision check (none of the three new
   files is a conventions-sync consumer) and a test that `mega connector
   sync` does not touch any `scripts/conventions-sync` managed path.
5. **Continue config-path wrong** (the open question, §4b). Mitigated
   by isolating the choice to one `relativePath` string with zero
   ripple; flagged as a one-line follow-up if the convention differs
   for the targeted Continue version.

## §10 Determinism & purity (constraints)

- The new commands' cores (`runConnectorList`, `runConnectorDoctor`)
  are I/O-bounded to file reads + an `access` probe; output is a pure
  function of (store state, project files). No clock, no network, no
  LLM. `doctor`'s drift check reuses `buildConnectorContext` +
  `upsertBlock` + `normalizeEol` exactly as `status` does, so a
  target's `ok`/`stale` verdict matches `status`'s `in-sync`/`drift`
  verdict for the same inputs (the only added axis is writability).
- The new targets are frozen literal objects (`Object.freeze`), pinned
  to `AgentId` via `satisfies` — identical to the shipped targets.
- The cross-agent test injects a fixed store/project/memory and asserts
  exact substrings + block-body equality; it has no time/randomness
  dependence beyond the deterministic seed.

## §11 Testing (TDD — tests first)

- **Shared enum (`agent-id.test.ts` / `.test-d.ts`):** `parse("gemini")`
  / `"windsurf"` / `"continue"` accepted; `members` length bumped;
  `.options` ordered tuple updated (runtime + type-level); a non-member
  still rejected. These are the drift guards — written first, they go
  RED until the schema widens.
- **generic-cli targets (`targets.test.ts`):** `geminiTarget` /
  `windsurfTarget` / `continueTarget` each expose the right `id` /
  `agentId` / `relativePath` and **no** `header`; `findTarget` returns
  each by id; `builtinTargets` length grows by three and contains all
  three; existing `codex`/`cursor`/`aider` assertions unchanged.
- **CLI sync (`connector.test.ts`):** seed-on-`--target` creates each
  new file with a Mega Saver block (`gemini`→`GEMINI.md`,
  `windsurf`→`.windsurfrules`, `continue`→`.continue/rules/megasaver.md`
  incl. parent `mkdir`); default sync (no `--target`) skips the missing
  new files; the four shipped targets stay byte-identical.
- **CLI status (`connector-status.test.ts`):** each new target reports
  `missing` then round-trips to `in-sync` after a seed.
- **CLI list (`connector-list.test.ts`, new):** lists all eight targets
  with `present`/`absent` correct for a half-seeded project; `--json`
  shape; exit 0 always.
- **CLI doctor (`connector-doctor.test.ts`, new):** `ok` for a
  current file; `stale` after memory advances (and exit 1); `missing`
  for absent (exit 0); `no-block` for a user file without sentinels
  (exit 0); `not-writable` via a chmod'd file/dir (exit 1) **without
  modifying the file**; `--target` filters; `--json` shape; the
  writability probe never creates/writes the probed path.
- **Cross-agent shared memory (`connector-cross-agent.test.ts`, new —
  the exit-criterion proof, §7):** project-scoped memory synced to
  `claude-code` + `cursor`; both files contain the memory content; the
  two sentinel block bodies are byte-equal; (optional) `gemini` paired
  with `claude-code` for the same guarantee.
- **Conventions-sync isolation:** a test asserting `mega connector sync`
  writes none of the `scripts/conventions-sync` managed paths
  (`CLAUDE.md` is written by the connector for the *block*, but the
  conventions managed *blocks* are untouched — assert the new targets'
  files are disjoint from the manifest `CONSUMERS` paths, and that
  `GEMINI.md` is not a conventions consumer).
- **GUI (`badges.test.tsx`, `session-forms.test.tsx`):** new agent
  labels render; dropdown options list updated to the new ordered set.
- **Type-level:** `KnownTargetId` resolves to the widened literal union
  (existing `known-targets` type test extended).

## §12 Decisions / open questions

- **Decided (central):** Phase 9 is an **additive widening** of the
  shipped connector subsystem, not a new subsystem. The four shipped
  targets and `buildConnectorContext`/`upsertBlock` are reused
  unchanged (§2).
- **Decided:** add **three** new targets — `gemini` (`GEMINI.md`),
  `windsurf` (`.windsurfrules`), `continue`
  (`.continue/rules/megasaver.md`) — each a frozen target object +
  one `agentIdSchema` literal, **no new sync code** (§3, §4).
- **Decided:** `vscode` + `jetbrains` are **deferred** (native IDE
  plugins, not config-file targets) (§4c, §8).
- **Decided:** add `mega connector list` + `mega connector doctor` to
  the existing `connector` group; **do not** add `mega connect` or
  rename the group (least churn, no duplicated sync logic) (§5c).
- **Decided:** `doctor` exit code is `1` on any `stale` /
  `not-writable` / `error`; `0` when every target is `ok` / `missing` /
  `no-block` (§5b). `list` always exits `0` (§5a).
- **Decided:** the new agents are **connector-sync targets only, not
  MCP-install targets** — `knownAgentIdSchema` / `detectAgent` stay
  unchanged (§6d).
- **Decided:** `GEMINI.md` is a **connector-only** file, **not** added
  to the conventions-sync manifest — no managed-block reconciliation
  (§2a).
- **Open (low, non-blocking):** `continue`'s exact rules path
  (`.continue/rules/megasaver.md` vs `.continuerules`). Isolated to one
  `relativePath` string; flagged for confirmation against the targeted
  Continue version (§4b). Does not block the enum/consumer work or the
  cross-agent proof.

## §13 Self-review

- **Reconciliation explicit?** §2a (target-by-target exists/missing
  table) + §2b (command table) + §2c (reused vs new) cover every
  target and command. ✓
- **Confirms the four shipped targets work?** §2a marks
  claude-code/codex/cursor/aider EXISTS, sourced to the shipped
  packages and `known-targets.ts`. ✓
- **gemini target added with real config path?** §3 (`GEMINI.md`),
  high confidence; enum widening §3a. ✓
- **windsurf/continue via the same pattern, no new sync code?** §4 —
  both are frozen target objects; §4c justifies fit; the only "new"
  filesystem behaviour (continue's parent dir) is already done by the
  existing seed branch. ✓
- **Every agentId consumer enumerated?** §6 — Class A (derived) /
  Class B (exhaustive `Record`) / Class C (hardcoded mirrors + pinned
  tests) / §6d (the NOT-touched `knownAgentIdSchema` boundary) / §6e
  (target registries). Cross-checked against a repo-wide
  `agentIdSchema`/`AgentId` grep. ✓
- **doctor/list semantics defined (output lines + exit codes)?** §5a
  (list: line shape, always-0) + §5b (doctor: six status words, exit
  rule, examples). ✓
- **IDE-plugin deferral explicit?** §4c + §8. ✓
- **Shared-memory proof?** §7 (two agents, two formats, content +
  block-body byte-equality). ✓
- **Conventions-sync reconciliation?** §2a collision check + §11
  isolation test; GEMINI.md deliberately not a conventions consumer. ✓
- **No LLM, no new package, no new sync engine?** §0, §2c, §10. ✓
- **Risk classified + mitigations?** §9 (HIGH, five risks). ✓
- **Open question flagged, not guessed?** §4b (continue path),
  non-blocking, one-line ripple. ✓
