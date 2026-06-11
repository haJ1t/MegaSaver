# Mega Saver

> **ContextOps platform for frontier coding agents.**
> Less tokens. More signal. Same or better agent performance.

Mega Saver is a single control panel for context, memory, sessions
and token efficiency across modern coding agents — Claude Code,
Codex, Cursor, Aider, and any CLI agent. The non-negotiable
principle: **agents connect to Mega Saver, never the reverse.**
Every connector is a thin adapter. Core stays agent-agnostic.

**Status:** v1.1 shipped (2026-06-04); current `main` carries the
post-v1.1 arc through PR #112. The v0.1 headless MVP, the v1.0
**Context Gate** epic (Mega Saver Mode), and **full Windows support**
are complete; CI is green on both `ubuntu-latest` and `windows-latest`.
Published package versions: `@megasaver/cli` 1.0.2, `@megasaver/gui`
1.1.0, `@megasaver/core` 1.0.2. The CLI is distributed as a standalone
`mega.mjs` bundle on GitHub Releases; the npm publish path is wired and
unlocks the moment a maintainer supplies `NPM_TOKEN` (see
[Distribution](#distribution)).

---

## Table of contents

- [Why Mega Saver](#why-mega-saver)
- [Quickstart](#quickstart)
- [Distribution](#distribution)
- [Architecture](#architecture)
- [Storage layout](#storage-layout)
- [The `mega` CLI](#the-mega-cli)
- [Connectors](#connectors)
- [GUI app](#gui-app)
- [Mega Saver Mode](#mega-saver-mode)
- [Skill packs](#skill-packs)
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
- **Mega Saver Mode** — session-scoped, MCP-backed output compression
  that routes large tool output through a deterministic redact → chunk
  → rank → fit → summarize pipeline, so only the signal reaches the
  model and the raw evidence stays on disk.
- **Closed-set surfaces** for every public type — agent IDs,
  risk levels, memory scopes, error codes — pinned at compile time
  with `.test-d.ts` tuple-ordering tests so adding a member is
  a deliberate, reviewable change.
- **Atomic, durable JSON storage** that is correct on both POSIX
  (fsync-on-rename) and Windows (NTFS-aware path + `r+` fsync), with
  no external database.
- **Symmetrical CLI surface:** every read and write command supports
  `--json` for scripting, with text output preserved as the default
  for humans.
- **Multi-agent dogfooding:** the project's own per-agent files
  (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`) are all regenerated
  from a single source of truth (`docs/conventions/*.md`) via
  `pnpm conventions:sync`, with `conventions:check` guarding drift in CI.

What Mega Saver is **not**:

- Not a model proxy or token blinder. It preserves evidence; it
  never strips what the model needs to decide.
- Not a team chatops tool. Single-developer first.
- Not yet on npm. The CLI ships today as a standalone bundle on
  GitHub Releases; the npm path is one maintainer secret away.

---

## Quickstart

### Requirements

- **Node 22 LTS** (or newer; pinned via `.nvmrc`)
- **pnpm 9.x** via Corepack (`corepack enable`)
- macOS, Linux, or **Windows** — all three are supported and covered
  by CI (`ubuntu-latest` + `windows-latest`).

### Install and verify

```bash
git clone https://github.com/haJ1t/MegaSaver.git
cd MegaSaver
corepack enable
pnpm install
pnpm verify     # lint + typecheck + test + conventions:check
```

`pnpm verify` is the full Definition-of-Done gate. Expect the full
suite green on `main` (both CI legs pass).

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
# 1. Create a project (default store: $XDG_DATA_HOME/megasaver,
#    or %LOCALAPPDATA%\megasaver on Windows)
mega project create demo

# 2. Open a session inside it
mega session create demo --agent claude-code --title "first session"

# 3. Drop a memory entry
mega memory create demo --scope project \
  --content "User prefers TypeScript strict mode and Vitest."

# 4. Render the Claude Code connector block into the project's CLAUDE.md
mega connector sync demo --target claude-code

# 5. Inspect connector state
mega connector status demo --target claude-code
```

Every command above accepts `--json` for headless / agent use.
The text output stays the default for humans.

### Run the GUI

```bash
# One process boots both the Vite dev server (5173) and the bridge (5174)
pnpm --filter @megasaver/gui dev
```

Open <http://localhost:5173>. The console shows **Sessions** and
**Memory entries**, an **Agent Setup Doctor**, and per-session
**Mega Saver Mode** controls — all rendered straight from
`@megasaver/core`.

---

## Distribution

The `mega` CLI ships two ways. Both deliver the same artifact: a
single self-contained ESM file with every dependency — the
`@megasaver/*` packages, `citty`, `zod`, and the MCP SDK — inlined.
Only Node builtins stay external, so it runs from anywhere with no
`node_modules`.

### Standalone bundle (GitHub Releases)

Every `v*` tag attaches `mega.mjs` (and a version-stamped
`mega-<version>.mjs`) to a GitHub Release. No registry account
needed.

```bash
# Download the latest bundle and run it (Node 22+ required).
curl -fsSL -o mega.mjs \
  https://github.com/haJ1t/MegaSaver/releases/latest/download/mega.mjs
node mega.mjs doctor

# Or put it on PATH as `mega`:
chmod +x mega.mjs
mv mega.mjs ~/.local/bin/mega   # any dir on your PATH
mega doctor
```

The file carries a `#!/usr/bin/env node` shebang, so once it is
executable and on your PATH it runs as `mega`.

### npm

When published, the self-contained package installs globally:

```bash
npm i -g @megasaver/cli
mega doctor
```

`@megasaver/cli` bundles its dependencies into the published
artifact, so it has **no runtime dependencies** and the internal
`@megasaver/*` packages stay private.

> npm publishing is wired but **gated on a maintainer-supplied
> token** (the package is not on npm until a maintainer enables it).
> The `release.yml` workflow's `npm-publish` job runs only when the
> `NPM_TOKEN` repository secret is set. To enable it: own the
> `@megasaver` scope on npmjs.com, create an automation token with
> publish rights, and add it as the `NPM_TOKEN` repository secret
> (Settings → Secrets and variables → Actions). The next `v*` tag
> then also publishes to npm. Until then, every tag still ships the
> GitHub Release bundle.

### From source

See [Run the CLI from the workspace](#run-the-cli-from-the-workspace)
for the dev path (`pnpm --filter @megasaver/cli build`), or build the
bundle yourself:

```bash
pnpm --filter @megasaver/cli bundle   # → apps/cli/dist-bundle/mega.mjs
```

### How a release is cut

Tag a release commit and push the tag; the
[`release.yml`](.github/workflows/release.yml) workflow does the
rest (the GitHub Release always runs; npm publish runs only if
`NPM_TOKEN` is set):

```bash
git tag v1.0.2            # match the @megasaver/cli version
git push origin v1.0.2
```

---

## Architecture

```
┌──────────────────┐   ┌──────────────────┐
│  Coding agent A  │   │  Coding agent B  │
│  (Claude Code,   │   │  (Codex, Cursor, │
│   Aider, …)      │   │   any CLI agent) │
└────────┬─────────┘   └────────┬─────────┘
         │ per-agent files       │ MCP tools (Mega Saver Mode)
         ▼                       ▼
┌──────────────────────────────────────────┐
│      Connectors      ·      MCP bridge   │
│  claude-code · codex · cursor · aider    │
│  (thin adapters)     (stdio MCP server)  │
└──────────────┬───────────────────────────┘
               │ public API only
               ▼
┌──────────────────────────────────────────┐
│   @megasaver/core  +  Context Gate       │
│  Schemas (Zod) · Registry · JSON store   │
│  policy · output-filter · content-store  │
│  retrieval (BM25) · stats                │
└──────────────┬───────────────────────────┘
               │ on-disk
               ▼
        <store>/   (XDG / %LOCALAPPDATA%)
        ├─ projects.json
        ├─ sessions.json
        └─ memory/<projectId>.jsonl
```

**Hard rule:** Core never imports connector or CLI code. The five
Context Gate leaf packages (`policy`, `output-filter`, `content-store`,
`retrieval`, `stats`) must not import core. Connectors import Core. The
CLI imports Core, connectors, and the Context Gate. The GUI imports
Core directly through a tiny localhost bridge.

---

## Storage layout

Mega Saver stores everything as plain JSON / JSONL on disk. No
database, no service, no daemon.

| Path | Format | Contents |
|------|--------|----------|
| `<store>/projects.json` | JSON | Array of `Project` records (id, name, rootPath, createdAt). |
| `<store>/sessions.json` | JSON | Array of `Session` records (project id, agent id, title, status, risk level, `tokenSaver`, createdAt, endedAt). |
| `<store>/memory/<projectId>.jsonl` | JSONL | One `MemoryEntry` per line, scoped to the owning project. |

**Default store path:**

- `$XDG_DATA_HOME/megasaver` if set, else `~/.local/share/megasaver`
  (macOS / Linux)
- `%LOCALAPPDATA%\megasaver` on Windows
- override on any command with `--store <path>`

**Durability guarantees:**

- All writes go through `atomicWriteFile`: write to a temp file in
  the same directory, `fsync` the temp file, `rename` over the
  target, then `fsync` the parent directory (POSIX). On Windows the
  parent fsync is skipped (NTFS journals rename metadata) and the
  temp file is opened with `r+` so its handle can be fsynced safely.
- On any error, the original file is untouched.
- Concurrent writes from a single process are serialised via
  per-key locks; cross-process behaviour is best-effort and
  documented in spec §11.
- Project ids are lowercase UUIDs and all stored paths are
  platform-correct, so a store written on one OS reads on the other.

---

## The `mega` CLI

The CLI is built with [Citty](https://unjs.io/packages/citty).
**Every read and write command supports `--json`** (`mega doctor` is
text-only by design). The `--json` contract is uniform: success →
JSON to stdout, exit 0, no stderr; failure → text to stderr
(`error: …`), exit 1, **no stdout**.

### Projects & diagnostics

```bash
mega doctor                                   # Node/platform/store/connector checks
mega project create <name> [--root <dir>] [--store <dir>] [--json]
mega project list   [--store <dir>] [--json]
```

### Sessions

```bash
mega session create <project> --agent <id> [--risk low|medium|high|critical] [--title <s>]
mega session list   <project> [--store <dir>] [--json]
mega session show   <session-id> [--json]
mega session update <session-id> [--title <s>] [--risk <level>] [--agent <id>]
mega session end    <session-id> [--json]
```

### Memory

```bash
mega memory create <project> --scope project|session --content <s> [--session <id>]
mega memory list   <project> [--json]
mega memory show   <entry-id> [--json]
```

### Connectors

```bash
mega connector sync   <project> [--target <id>] [--json]
mega connector status <project> [--target <id>] [--json]
```

### Mega Saver Mode (Context Gate)

```bash
mega session saver enable  <session-id> --mode safe|balanced|aggressive
mega session saver disable <session-id>
mega session saver status  <session-id> [--json]
mega session saver stats   <session-id> [--json]   # raw/returned/saved totals

mega output file   <session-id> --intent <s> <path>      # policy-gated read + filter
mega output filter <session-id> --intent <s> --file <log>
mega output exec   <session-id> --intent <s> -- <cmd…>    # policy-gated child process
mega output chunk  <chunk-set-id> <chunk-id>             # drill into a stored excerpt

mega mcp install|repair|status|uninstall [--target <id>] [--project <name>]
mega mcp serve                                            # stdio MCP server entry
```

### Skill packs

```bash
mega pack install <path> [--force] [--root <dir>]
mega pack list    [--root <dir>] [--json]
mega pack info    <name> [--root <dir>]
mega pack remove  <name> [--root <dir>]
```

Closed-enum CLI surfaces (`--agent`, `--risk`, `--scope`, `--target`,
`--mode`) derive their help text and error messages directly from the
source schema, with `describe.each` drift guards pinning the exact
format so adding a member can't silently skew a surface.

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
  shared block helpers, the additive `CONTEXT_GATE` context block,
  and renderer utilities.

> **Two block families.** Connectors write a per-project **memory**
> block (`MEGA SAVER:…` sentinels). The repo's own governance files
> are managed by a *separate* dogfood tool, `pnpm conventions:sync`,
> which uses `<!-- conventions:start/end -->` sentinels — see
> [Development → Multi-agent dogfooding](#multi-agent-dogfooding).

---

## GUI app

`apps/gui` (`@megasaver/gui` 1.1.0) is a localhost web console over
the same Core registry.

- **Frontend:** Vite + React 18 + Tailwind, single-page app, port 5173.
  Design language in `apps/gui/DESIGN.md` ("Editorial Terminal").
- **Bridge:** Node `http` server, port 5174, imports
  `@megasaver/core` directly (no subprocess, no CLI parsing).
- **One-command dev:** `pnpm --filter @megasaver/gui dev` boots Vite +
  bridge together (`/api/*` proxied to the bridge, loopback-only CORS).
- **Views & actions:** `Sessions` and `Memory entries` with write
  actions (create / end / update sessions, create memory); an
  **Agent Setup Doctor** that installs / repairs the MCP bridge and
  connector block per agent with no terminal; and a per-session
  **Token Saver panel** (mode picker, savings ratio, an inline-SVG
  savings chart, recent-events feed, raw/sent viewer, and raw-output
  retention controls).
- **Accessibility:** WCAG AA contrast pass (PRs #85/#87),
  keyboard-reachable, `aria-live` savings announcements.

Native window packaging (Tauri / Electron) was evaluated and
deferred — Tauri needs a Rust toolchain in onboarding, Electron's
bundle weight is hard to justify pre-demand. It is tracked in the
[Roadmap](#roadmap).

---

## Mega Saver Mode

Mega Saver Mode is session-scoped, GUI-controlled, MCP-backed output
compression. Turn it on for a session and the agent stops drowning in
raw tool output: every large file read, command run, or build/test log
is routed through a deterministic redact → chunk → rank → fit →
summarize pipeline, and only the most relevant excerpts reach the
model. The raw evidence stays on your disk; the agent sees the signal.

**Less tokens. More signal. Same or better agent performance.**

### One click

In the GUI, open **Sessions**, pick a session, and click **Enable Mega
Saver Mode**. Choose a mode. Mega Saver then, in one step:

- writes the session's `tokenSaver` settings,
- syncs the connector instruction block into the agent's config file,
- installs or repairs the MCP bridge for the agent,
- initializes per-session stats,
- verifies the content store.

The Sessions detail pane shows **Mega Saver Mode: ON**, whether the
agent is ready, and whether a restart is needed. No terminal required.

The same flow is available from the CLI:

```bash
mega session saver enable <session-id> --mode balanced
mega mcp repair --target claude-code --project <name>
mega connector sync <name> --target claude-code
```

### Modes

Each mode caps the bytes returned to the agent per call. The cap is the
single source of truth in `modeToBudget()` and is shared by the CLI,
the MCP bridge, and the GUI.

| Mode | Returned-byte budget | Use when |
|------|----------------------|----------|
| `safe` | 32 000 | You want more context retained; exploratory work. |
| `balanced` | 12 000 | Default. Strong savings, ample signal. |
| `aggressive` | 4 000 | Maximum savings; tight, focused tasks. |

### Measurable savings

Every routed call records `rawBytes`, `returnedBytes`, `bytesSaved`,
and a `savingRatio`. The Sessions panel shows the running total — e.g.
**Raw 380 KB · Sent 24 KB · Saved 93.7%** — a savings-history chart,
and a feed of recent events. Read the live numbers anytime:

```bash
mega session saver stats <session-id>
```

### Raw / sent viewer

Compression never deletes evidence. For any event you can open the
**raw** captured output and the **sent** filtered excerpts side by
side in the GUI (they stream straight from the local content store).
Ask for the raw bytes only when the filtered result is genuinely
insufficient.

### MCP tools

When Mega Saver Mode is on, the connector block tells the agent to
prefer the Mega Saver MCP tools over native ones — `mega_read_file`,
`mega_run_command`, `mega_fetch_chunk`, and `mega_recall`. The bridge
(`@megasaver/mcp-bridge`, a real MCP server over `stdio`) gates every
command through the policy allow/deny list and runs the redaction
pipeline before any output is stored or returned. Command execution
never escapes the allow-list, and secrets are redacted before
persistence.

---

## Skill packs

`@megasaver/skill-packs` (1.0.0) is a real, installable bundle format
for Mega-Saver-native skills, driven by the `mega pack` CLI.

- `loadPack(path)` reads and Zod-validates a `megasaver-pack.json`
  manifest (kebab name, SemVer version, kind, skills, capabilities).
- `discoverPacks(...)` scans the workspace then the global root;
  workspace wins on name collision, corrupt packs are skipped with
  warnings rather than failing the scan.
- `installPack(...)` is validate-before-copy with a full-tree symlink
  sweep, a shadow-aware skill-id conflict scan, and atomic
  `.tmp-<name>` staging + rename.
- Security guards use `path.relative` containment (not lexical prefix);
  absolute entry paths and symlinks anywhere in a source tree are
  rejected, all surfacing as `pack_path_escape`.

Closed 7-member `SkillPackError` enum. Installs land in
`<workspace>/.megasaver/packs/<name>/`; the global discovery root is
`<XDG_DATA_HOME|~/.local/share>/megasaver/packs/`. Deferred: URL
installs, lockfile, signing, registry, and the skill runtime.

---

## Development

### Stack

| Concern | Tool |
|---------|------|
| Runtime | Node 22 LTS |
| Language | TypeScript strict, ESM only, NodeNext, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
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
pnpm test                          # vitest run (CI mode)
pnpm test:watch                    # vitest watch
pnpm lint                          # biome check
pnpm lint:fix                      # biome check --write
pnpm typecheck                     # tsc -b --noEmit + .test-d.ts via vitest
pnpm conventions:check             # docs/conventions/* drift gate
pnpm conventions:sync --write      # regenerate CLAUDE.md + AGENTS.md + .mdc
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
   are never the same active context); HIGH-risk work adds an
   adversarial `critic` pass.
6. **Wiki update** — append to `wiki/log.md` and link from
   `wiki/index.md`.
7. **Merge** as a single squash commit.

Hard gates: no implementation without an approved spec, no merge
without `pnpm verify` green, no merge without external reviewer
pass, no "done" claim without verifier evidence.

### Closed-enum discipline

Every public string union (agent IDs, risk levels, memory scopes,
error codes, view IDs, sync modes) ships with a `const` `as const`
array, a Zod schema derived from it, and a `.test-d.ts` tuple-ordering
test that pins the **exact** member order at compile time. Adding a
member triggers a typecheck failure that surfaces in review before
runtime.

### Multi-agent dogfooding

`docs/conventions/*.md` is the single source of truth for the
project's own conventions — **fourteen** canonical files
(`wiki-first.md` for §0 plus one per `CLAUDE.md` section §1–§13).
Sentinel-bounded blocks (`<!-- conventions:start id="…" source="…" -->`
… `<!-- conventions:end id="…" -->`) in **`CLAUDE.md`**, `AGENTS.md`,
and the three `.cursor/rules/*.mdc` files are populated by
`pnpm conventions:sync`. As of PR #112, **`CLAUDE.md` is a managed
consumer** too (it was the last hand-maintained agent file); content
outside the blocks (section headings, `Source:` links) is hand-kept.

`pnpm conventions:check` runs inside `pnpm verify` and fails the build
on any drift between a managed file and its source.

---

## Repository layout

```
MegaSaver/
├─ apps/
│  ├─ cli/                       # `mega` command (Citty + Zod)
│  └─ gui/                       # Vite + React + node:http bridge
├─ packages/
│  ├─ core/                      # Engine: schemas, registry, JSON store
│  ├─ context-gate/             # Mega Saver Mode orchestrator (extracted from core)
│  ├─ policy/                    # Command/path gates + redaction
│  ├─ output-filter/            # redact → chunk → rank → fit → summarize
│  ├─ content-store/            # ChunkSet persistence
│  ├─ retrieval/                # BM25 ranking
│  ├─ stats/                     # Per-session token-saver stats
│  ├─ shared/                    # Cross-package contracts (IDs, enums)
│  ├─ mcp-bridge/                # Real MCP stdio server (4 tools)
│  ├─ skill-packs/               # Real pack loader / installer (`mega pack`)
│  └─ connectors/
│     ├─ shared/                 # Block helpers + context schema
│     ├─ claude-code/            # Claude Code connector
│     └─ generic-cli/            # Manifest-driven (codex/cursor/aider)
├─ scripts/
│  └─ conventions-sync/          # `pnpm conventions:sync` (manages CLAUDE.md too)
├─ docs/
│  ├─ conventions/               # Single source of truth for project rules
│  └─ superpowers/{specs,plans}/ # Brainstorm output + implementation plans
├─ wiki/                         # Persistent project memory (read first)
├─ .changeset/                   # Changesets release plumbing
├─ .cursor/rules/                # Generated; managed by conventions:sync
├─ CLAUDE.md                     # Claude Code governance (managed; generated)
├─ AGENTS.md                     # Codex governance (managed; generated)
├─ CONVENTIONS.md / GEMINI.md    # Aider / Gemini governance
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
  matrix, and v0.x → v1.1 close-out blocks. Read first.
- [`wiki/log.md`](wiki/log.md) — append-only chronological log
  of every meaningful change (one entry per merged PR or batch).
- [`wiki/entities/`](wiki/entities) — one page per subsystem
  (`core.md`, `cli.md`, `gui.md`, `conventions-sync.md`, …).
- [`wiki/concepts/`](wiki/concepts) — cross-cutting ideas
  (ContextOps, agent-agnostic core, the Context Gate pipeline,
  Windows support, superpowers discipline).
- [`wiki/syntheses/`](wiki/syntheses) — big-picture answers,
  including [`post-v1.1-roadmap.md`](wiki/syntheses/post-v1.1-roadmap.md).

Authoritative governance: [`CLAUDE.md`](CLAUDE.md) and the other
agent files are all regenerated from
[`docs/conventions/`](docs/conventions).

---

## Roadmap

### Shipped

- **v0.1** (2026-05) — Bootstrap, monorepo skeleton, Core schemas +
  JSON store, `mega project` commands, first connector (Claude Code).
- **v0.2** (2026-05) — All CLI subcommands, full read/write `--json`
  parity, 4 connector targets, POSIX-durable atomic writes,
  closed-enum compile-time discipline.
- **v0.3** (2026-05) — GUI bootstrap, `pnpm conventions:sync`
  automation, mcp-bridge & skill-packs scaffolding.
- **v1.0 — Context Gate epic (AA1)** — Mega Saver Mode end-to-end:
  the `policy` / `output-filter` / `content-store` / `retrieval` /
  `stats` packages, the `context-gate` orchestrator, the real
  `@megasaver/mcp-bridge` (stdio MCP server, 4 tools), and
  `mega session saver` / `mega output` / `mega mcp` CLI surfaces.
- **v1.1** (2026-06-04) — GUI Token Saver panel + savings chart +
  raw-output retention, Agent Setup Doctor, WCAG AA pass,
  `permissions.yaml` policy.
- **Post-v1.1 (PRs #102–#112)** — real stats wiring (#102), real
  skill-packs loader + `mega pack` (#103), **full Windows support**
  with a `windows-latest` CI matrix (#104–#108), `mcp` HOME→USERPROFILE
  fix (#109), test-file type-checking fix (#110), and **`CLAUDE.md`
  brought under `conventions:sync`** (#112).

### Remaining

1. **npm publish** — `@megasaver/cli` is not yet on npm; needs a
   maintainer to add the `NPM_TOKEN` secret and re-run `release.yml`.
   This is the one MVP → installable-product gap.
2. **GUI native packaging** — revisit Tauri / Electron.
3. **i18n** — product strings are English-only; add `tr` via
   `packages/shared/i18n`.
4. **Feature backlog (fikri §16)** — Token Audit, Repo Scanner,
   Ignore Generator, Instruction Optimizer, Context Packer,
   Conversation Compactor, Memory Vault.

Full, source-cited detail in
[`wiki/syntheses/post-v1.1-roadmap.md`](wiki/syntheses/post-v1.1-roadmap.md).

---

## Contributing

This repo is in solo development through v1.x. Pull requests are
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
