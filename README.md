# Mega Saver

> **ContextOps platform for frontier coding agents.**
> Less tokens. More signal. Same or better agent performance.

Mega Saver is a single control panel for context, memory, sessions
and token efficiency across modern coding agents — Claude Code,
Codex, Cursor, Aider, and any CLI agent. The non-negotiable
principle: **agents connect to Mega Saver, never the reverse.**
Every connector is a thin adapter. Core stays agent-agnostic.

**Status:** v0.3 shipped (2026-05-10). 626 tests across 62 files,
55 PRs merged since project bootstrap. Pre-1.0; APIs may break
across minor versions until 1.0. Not yet published to npm.

---

## Table of contents

- [Why Mega Saver](#why-mega-saver)
- [Quickstart](#quickstart)
- [Architecture](#architecture)
- [Storage layout](#storage-layout)
- [The `mega` CLI](#the-mega-cli)
- [Connectors](#connectors)
- [GUI app](#gui-app)
- [Future packages](#future-packages)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Project memory](#project-memory)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Why Mega Saver

Frontier coding agents share one operational problem: **context is
fragile and expensive.** Every agent reinvents memory, every IDE
plugin re-implements session tracking, and every team stitches
ad-hoc per-agent config files (`CLAUDE.md`, `AGENTS.md`,
`.cursor/rules/`, `CONVENTIONS.md`) by hand.

Mega Saver solves this with a small, opinionated layer:

- **One persistent store** for projects, sessions and memory entries
  that any agent can read or write through a connector.
- **Closed-set surfaces** for every public type — agent IDs,
  risk levels, memory scopes, error codes — pinned at compile time
  with `.test-d.ts` tuple-ordering tests so adding a member is
  a deliberate, reviewable change.
- **Atomic, durable JSON storage** (POSIX fsync-on-rename + NTFS-aware
  Windows path) with no external database.
- **Symmetrical CLI surface:** every read and write command supports
  `--json` for scripting, with text output preserved as the default
  for humans.
- **Multi-agent dogfooding:** the project's own per-agent files
  (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`) are kept in sync
  from a single source of truth via `pnpm conventions:sync`.

What Mega Saver is **not**:

- Not a model proxy or token blinder. It preserves evidence; it
  never strips what the model needs to decide.
- Not a team chatops tool. Single-developer first.
- Not yet a packaged product. v0.3 ships the core, CLI, four
  connector targets, a localhost GUI bootstrap, and placeholder
  packages for an MCP bridge and skill packs.

---

## Quickstart

### Requirements

- **Node 22 LTS** (or newer; pinned via `.nvmrc`)
- **pnpm 9.x** via Corepack (`corepack enable`)
- A POSIX shell (macOS / Linux). The Windows code path is
  correct-by-construction, but Windows CI is not yet in place.

### Install and verify

```bash
git clone https://github.com/haJ1t/MegaSaver.git
cd MegaSaver
corepack enable
pnpm install
pnpm verify     # lint + typecheck + test + conventions:check
```

`pnpm verify` is the full Definition-of-Done gate. Expect 626
tests across 62 files in green on `main`.

### Run the CLI from the workspace

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/cli.js doctor
```

Or alias the binary for the session:

```bash
alias mega="node $PWD/apps/cli/dist/cli.js"
mega doctor
```

### A complete first flow

```bash
# 1. Create a project (default store: $XDG_DATA_HOME/megasaver)
mega project create demo

# 2. Open a session inside it
mega session create --project demo --title "first session" --agent claude-code

# 3. Drop a memory entry
mega memory create \
  --project demo \
  --content "User prefers TypeScript strict mode and Vitest." \
  --scope project

# 4. Render the Claude Code connector block into root CLAUDE.md
mega connector sync --target claude-code --project demo

# 5. Inspect connector state
mega connector status --target claude-code --project demo
```

Every command above accepts `--json` for headless / agent use.
The text output stays the default for humans.

### Run the GUI

```bash
# Terminal 1 — bridge (port 5174)
pnpm --filter @megasaver/gui bridge

# Terminal 2 — Vite dev server (port 5173, proxied to bridge)
pnpm --filter @megasaver/gui dev
```

Open <http://localhost:5173>. Two views ship in v0.3: **Sessions**
and **Memory entries**, both rendered straight from
`@megasaver/core`.

---

## Architecture

```
┌──────────────────┐   ┌──────────────────┐
│  Coding agent A  │   │  Coding agent B  │
│  (Claude Code,   │   │  (Codex, Cursor, │
│   Aider, …)      │   │   any CLI agent) │
└────────┬─────────┘   └────────┬─────────┘
         │ reads/writes          │ reads/writes
         │ per-agent files       │ per-agent files
         ▼                       ▼
┌──────────────────────────────────────────┐
│              Connectors                  │
│  claude-code · codex · cursor · aider    │
│  (thin adapters; one block per target)   │
└──────────────┬───────────────────────────┘
               │ public API only
               ▼
┌──────────────────────────────────────────┐
│              @megasaver/core             │
│  Schemas (Zod) · Registry · JSON store   │
│  Atomic writes · Closed-enum errors      │
└──────────────┬───────────────────────────┘
               │ on-disk
               ▼
        ~/.local/share/megasaver/
        ├─ projects.json
        ├─ sessions.json
        └─ memory/<projectId>.jsonl
```

**Hard rule:** Core never imports connector or CLI code. Connectors
import Core. The CLI imports Core and connectors. The GUI imports
Core directly through a tiny localhost bridge.

---

## Storage layout

Mega Saver stores everything as plain JSON / JSONL on disk. No
database, no service, no daemon.

| Path | Format | Contents |
|------|--------|----------|
| `<store>/projects.json` | JSON | Array of `Project` records (id, name, createdAt). |
| `<store>/sessions.json` | JSON | Array of `Session` records (project id, agent id, title, status, risk level, createdAt, endedAt). |
| `<store>/memory/<projectId>.jsonl` | JSONL | One `MemoryEntry` per line, scoped to the owning project. |

**Default store path:**

- `$XDG_DATA_HOME/megasaver` if set
- `~/.local/share/megasaver` otherwise
- override on any command with `--store <path>`

**Durability guarantees:**

- All writes go through `atomicWriteFile`: write to a temp file in
  the same directory, `fsync` the temp file, `rename` over the
  target, then `fsync` the parent directory (POSIX) or skip the
  parent fsync (Windows — NTFS journals rename metadata; see the
  `wiki/log.md` GG entry for the design rationale).
- On any error, the original file is untouched.
- Concurrent writes from a single process are serialised via
  per-key locks; cross-process behaviour is best-effort and
  documented in spec §11.

---

## The `mega` CLI

The CLI is built with [Citty](https://unjs.io/packages/citty) and
exports 11 subcommands. **Every read and write command supports
`--json`** (10 of 11; `mega doctor` is text-only by design).

### Project commands

```bash
mega project create <name> [--store <dir>] [--json]
mega project list [--store <dir>] [--json]
```

### Session commands

```bash
mega session create --project <name|id> --title <s> --agent <id> \
                    [--risk low|medium|high|critical] [--store <dir>] [--json]
mega session list   [--project <name|id>] [--store <dir>] [--json]
mega session show   <session-id> [--store <dir>] [--json]
mega session update <session-id> [--title <s>] [--risk <level>] \
                                 [--agent <id>] [--store <dir>] [--json]
mega session end    <session-id> [--store <dir>] [--json]
```

### Memory commands

```bash
mega memory create --project <name|id> --content <s> --scope project|session \
                   [--session <id>] [--store <dir>] [--json]
mega memory list   [--project <name|id>] [--scope <s>] [--store <dir>] [--json]
mega memory show   <entry-id> [--store <dir>] [--json]
```

### Connector commands

```bash
mega connector sync   --target <id> [--project <name|id>] [--store <dir>] [--json]
mega connector status --target <id> [--project <name|id>] [--store <dir>] [--json]
```

### Diagnostics

```bash
mega doctor
```

Prints Node version, store path, store readiness, and connector
target availability. Run this first when debugging install issues.

### `--json` contract

- **Success:** JSON to stdout, exit 0, no stderr.
- **Failure:** text to stderr (`error: …`), exit 1, **no stdout**.
- Drift between commands is enforced by
  `apps/cli/test/json-failure-paths.test.ts` plus `describe.each`
  drift guards (30 assertions across the 10 `--json` commands).

---

## Connectors

Mega Saver ships four built-in connector targets. Each target reads
the same Core registry and writes to **one** file per target,
inside a sentinel-bounded block. User content outside the block
is preserved verbatim across syncs.

| Target | File written | Format |
|--------|--------------|--------|
| `claude-code` | `CLAUDE.md` (project root) | Markdown block |
| `codex` | `AGENTS.md` (project root) | Markdown block |
| `cursor` | `.cursor/rules/megasaver.mdc` | Cursor rule with frontmatter |
| `aider` | `CONVENTIONS.md` | Plain markdown (read by Aider via `--read`) |

Sentinel format (illustrative; exact tags vary by target):

```md
<!-- MEGA SAVER:BEGIN -->
# Mega Saver Context

Agent: claude-code
Project: demo (uuid)
Session: first-session (uuid)
Risk: medium

## Memory

- [project:uuid] User prefers TypeScript strict mode and Vitest.
<!-- MEGA SAVER:END -->
```

`mega connector status` reports one of `in-sync`, `drift`,
`no-block`, `missing`, `error` per target, with byte-symmetric
output across `sync` and `status` (every line carries
`session=<id|none>`).

Connector packages:

- [`@megasaver/connector-claude-code`](packages/connectors/claude-code)
- [`@megasaver/connector-generic-cli`](packages/connectors/generic-cli)
  — manifest-driven adapter that powers `codex`, `cursor`, and
  `aider` targets.
- [`@megasaver/connectors-shared`](packages/connectors/shared) —
  shared block helpers, context schema, and renderer utilities.

---

## GUI app

`apps/gui` is a localhost web shell over the same Core registry.

- **Frontend:** Vite + React 18, single-page app, port 5173.
- **Bridge:** Node `http` server, port 5174, imports
  `@megasaver/core` directly (no subprocess, no CLI parsing).
- **Vite proxy:** `/api/*` → `http://localhost:5174` so the SPA
  can call `fetch('/api/sessions')` without CORS.
- **Views:** `Sessions`, `Memory entries`. View switching is
  pinned with a `ViewId = ["memory", "sessions"]` closed enum.

Tauri and Electron were both evaluated for v0.3 and rejected:
Tauri required a Rust toolchain in contributor onboarding,
Electron's bundle weight was hard to justify before any user
demand. Both will be revisited in v0.4.

What's deferred to v0.4:

- Project picker and per-project filtering UI
- Session and memory entry detail views
- Write actions (create / end / update from the UI)
- Single-command `dev` that boots Vite + bridge under one process
- Native window packaging

---

## Future packages

Two workspace slots are reserved with locked public API and
`not_implemented` runtime errors. Both ship from v0.3 with closed-enum
tuple-ordering pins so the surface widens deliberately.

### `@megasaver/mcp-bridge`

A future Model Context Protocol bridge so Mega Saver can serve
sessions and memory entries to MCP-aware clients. The factory
`createBridge(config)` returns `{ transport, start(), stop() }`.
The closed enum `McpTransport = ["stdio", "sse"]` reserves the
launch order. Reserved future error codes
(`auth_failed`, `transport_closed`, `tool_not_found`, …) are
documented in
[`docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md`](docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md).

### `@megasaver/skill-packs`

A future installable bundle format for Mega-Saver-native skills.
The factory `loadPack(path)` will read a manifest with kebab name,
SemVer version, kind, skills, and capabilities. Closed enums:
`SkillPackKind = ["prompt", "skill", "workflow"]`,
`SkillPackCapability = ["network", "read-memory", "write-memory"]`.
Spec at
[`docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md`](docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md).

---

## Development

### Stack

| Concern | Tool |
|---------|------|
| Runtime | Node 22 LTS |
| Language | TypeScript 5.7 strict, ESM only, NodeNext, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Package manager | pnpm 9.x workspaces |
| Build | tsup per package, Turborepo orchestration |
| Test | Vitest (runtime + typecheck mode for `.test-d.ts` pins) |
| Lint + format | Biome |
| Type-check | `tsc --noEmit` with project references |
| CLI framework | Citty (UnJS) |
| Validation | Zod |
| Versioning | Changesets |

### Commands

```bash
pnpm install                       # install all workspaces
pnpm dev                           # turbo dev — watch all packages
pnpm build                         # turbo build — emit dist/
pnpm test                          # vitest run (CI mode, 626/626 expected)
pnpm test:watch                    # vitest watch
pnpm lint                          # biome check
pnpm lint:fix                      # biome check --write
pnpm typecheck                     # tsc -b --noEmit + .test-d.ts via vitest
pnpm conventions:check             # docs/conventions/* drift gate
pnpm conventions:sync              # write canonical content into AGENTS.md + .mdc
pnpm verify                        # lint + typecheck + test + conventions:check
pnpm --filter @megasaver/<pkg> <cmd>
```

### Process discipline

Every feature follows the **superpowers chain** (see
[`docs/superpowers/`](docs/superpowers)):

1. **Brainstorm** the spec — `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
2. **Plan** the implementation — `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`
3. **TDD** with Vitest — write the failing test first.
4. **Verify** with `pnpm verify` — lint + typecheck + test + conventions:check.
5. **Review** with an external reviewer agent (author and reviewer
   are never the same active context).
6. **Wiki update** — append to `wiki/log.md` and link from
   `wiki/index.md`.
7. **Merge** as a single squash commit.

Hard gates: no implementation without an approved spec, no merge
without `pnpm verify` green, no merge without external reviewer
pass, no "done" claim without verifier evidence.

### Closed-enum discipline

Every public string union (agent IDs, risk levels, memory scopes,
error codes, view IDs, sync modes) ships with:

- A `const` array (`as const`) defining the canonical members.
- A Zod schema derived from the array.
- A `.test-d.ts` tuple-ordering test that pins the **exact** member
  order at compile time.

Adding a member triggers a typecheck failure that surfaces in
review before runtime. See `apps/cli/src/known-targets.ts` and
`apps/cli/test/known-targets.test-d.ts` for the canonical pattern.

### Multi-agent dogfooding

`docs/conventions/*.md` is the single source of truth for the
project's own conventions. Sentinel-bounded blocks
(`<!-- conventions:start id="..." source="..." -->` …
`<!-- conventions:end id="..." -->`) in `AGENTS.md` and the three
`.cursor/rules/*.mdc` files are populated by `pnpm conventions:sync`.

`pnpm conventions:check` runs in `pnpm verify` and fails the build
on drift. `CLAUDE.md` is intentionally kept as the long-form
reference and is not yet under tagged-block management (planned
for v0.4).

---

## Repository layout

```
MegaSaver/
├─ apps/
│  ├─ cli/                       # `mega` command (Citty + Zod)
│  └─ gui/                       # Vite + React + node:http bridge
├─ packages/
│  ├─ core/                      # Engine: schemas, registry, JSON store
│  ├─ shared/                    # Cross-package contracts (IDs, enums)
│  ├─ mcp-bridge/                # Placeholder; locked public API
│  ├─ skill-packs/               # Placeholder; locked public API
│  └─ connectors/
│     ├─ shared/                 # Block helpers + context schema
│     ├─ claude-code/            # Claude Code connector
│     └─ generic-cli/            # Manifest-driven (codex/cursor/aider)
├─ scripts/
│  └─ conventions-sync/          # `pnpm conventions:sync` automation
├─ docs/
│  ├─ conventions/               # Single source of truth for project rules
│  └─ superpowers/
│     ├─ specs/                  # Brainstorm output (design docs)
│     └─ plans/                  # Implementation plans
├─ wiki/                         # Persistent project memory (read first)
├─ .changeset/                   # Changesets release plumbing
├─ .cursor/rules/                # Generated; managed by conventions:sync
├─ AGENTS.md                     # Codex governance (managed)
├─ CLAUDE.md                     # Claude Code governance (canonical)
├─ GEMINI.md                     # Gemini CLI governance
├─ CONVENTIONS.md                # Aider governance (generated)
├─ pnpm-workspace.yaml
├─ turbo.json
├─ biome.json
└─ tsconfig.base.json
```

---

## Project memory

Mega Saver eats its own dog food: the `wiki/` folder is the
project's persistent memory across agent sessions. Start there
when resuming work.

- [`wiki/index.md`](wiki/index.md) — current state, capability
  matrix, and v0.x close-out blocks. Read first.
- [`wiki/log.md`](wiki/log.md) — append-only chronological log
  of every meaningful change (one entry per merged PR or batch).
- [`wiki/entities/`](wiki/entities) — one page per subsystem
  (`core.md`, `cli.md`, `connectors-claude-code.md`, …).
- [`wiki/concepts/`](wiki/concepts) — cross-cutting ideas
  (ContextOps, agent-agnostic core, risk-aware development,
  superpowers discipline, wiki-first token discipline).
- [`wiki/decisions/`](wiki/decisions) — locked-in choices with
  rationale.

Authoritative governance:

- [`CLAUDE.md`](CLAUDE.md) — Claude Code rules, source of truth.
- [`AGENTS.md`](AGENTS.md) — Codex mirror, regenerated.
- [`.cursor/rules/*.mdc`](.cursor/rules) — Cursor mirrors,
  regenerated.
- [`docs/conventions/`](docs/conventions) — shared canonical text.

---

## Roadmap

### Shipped

- **v0.1** (2026-05-03 → 2026-05-04) — Bootstrap, monorepo
  skeleton, Core schemas + JSON store, `mega project` commands,
  first connector (Claude Code).
- **v0.2** (2026-05-09 → 2026-05-10) — All 11 CLI subcommands,
  full read / write `--json` parity (10/10), 4 connector targets,
  POSIX-durable atomic writes, closed-enum compile-time discipline,
  ~40 critic-flagged follow-ups closed.
- **v0.3** (2026-05-10) — Real Windows durability path
  (NTFS-aware), `mcp-bridge` and `skill-packs` placeholder
  packages, GUI bootstrap (`apps/gui`), `pnpm conventions:sync`
  automation.

### v0.4 candidates

- **GUI v1:** project picker, detail views, write actions,
  single-command dev, native packaging revisit.
- **`mcp-bridge` real implementation:** stdio transport,
  `session.list` / `memory.list` MCP tools, read-only resources.
- **`skill-packs` real loader:** discovery, install / uninstall,
  manifest validation, conflict resolution.
- **Windows port remainder:** case-insensitive path resolution
  audit, CRLF normalization in connector outputs, lock file
  semantics on Windows, GitHub Actions Windows runner.
- **`CLAUDE.md` tagged-block management:** extend
  `pnpm conventions:sync` to manage `CLAUDE.md` sections.
- **Aider connector E2E:** `mega connector sync --target aider`
  drives `CONVENTIONS.md` end-to-end (currently hand-written).

---

## Contributing

This repo is in solo development through v1.0. Pull requests are
welcome, but the bar is high:

- Spec + plan in `docs/superpowers/` before code.
- TDD: failing test first, minimal implementation, refactor.
- `pnpm verify` green locally before opening a PR.
- External reviewer pass before merge (we use the
  `code-reviewer` and `critic` agents from
  [oh-my-claudecode](https://github.com/halitozger/oh-my-claudecode)).
- Wiki entry in `wiki/log.md` on every meaningful merge.

If you're an agent reading this: load `wiki/index.md` first; do
**not** bulk-read `wiki/raw/`.

---

## License

[MIT](LICENSE) © 2026 Halit Ozger
