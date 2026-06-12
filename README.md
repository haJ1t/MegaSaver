# Mega Saver

> **ContextOps platform for frontier coding agents.**
> Less tokens. More signal. Same or better agent performance.

Mega Saver is a single control panel for context, memory, sessions
and token efficiency across modern coding agents — Claude Code,
Codex, Cursor, Aider, and any CLI agent. The non-negotiable
principle: **agents connect to Mega Saver, never the reverse.**
Every connector is a thin adapter. Core stays agent-agnostic.

**Status:** the **10-phase ContextOps roadmap is complete on `main`**
(Phases 1–10, PRs #114–#123, 2026-06-12). On top of the v1.1 base —
the headless MVP, the v1.0 **Context Gate** epic (Mega Saver Mode), and
**full Windows support** — Mega Saver now ships structured memory
(DIMMEM), a semantic repo index, task-aware context pruning (LAMR), a
full MCP server (**25 tools**), failed-run learning (FORGE), a task
engine, a tool router, a token-savings audit dashboard, seven agent
connectors, and a memory-approval workflow. CI is green on both
`ubuntu-latest` and `windows-latest`. Package versions: `@megasaver/cli`
1.0.2, `@megasaver/gui` 1.1.0, `@megasaver/core` 1.0.2. The CLI is
distributed as a standalone `mega.mjs` bundle on GitHub Releases; the
npm publish path is wired and unlocks the moment a maintainer supplies
`NPM_TOKEN` (see [Distribution](#distribution)).

---

## Table of contents

- [Why Mega Saver](#why-mega-saver)
- [The ContextOps layer](#the-contextops-layer)
- [Quickstart](#quickstart)
- [Distribution](#distribution)
- [Architecture](#architecture)
- [Storage layout](#storage-layout)
- [The `mega` CLI](#the-mega-cli)
- [MCP tools](#mcp-tools)
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
- **A full ContextOps engine set** — structured memory (DIMMEM), a
  semantic repo index, task-aware context pruning (LAMR), failed-run
  learning (FORGE), a task engine, and a tool router — that remembers
  decisions, indexes the repo, gives an agent only the code and tools a
  task needs, and turns failures into reusable rules. See
  [The ContextOps layer](#the-contextops-layer).
- **A real MCP server** (`@megasaver/mcp-bridge`) exposing **25 tools**
  over `stdio`, so an agent reaches memory, context packs, rules,
  tasks, tool routing, and the audit dashboard natively. See
  [MCP tools](#mcp-tools).
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

## The ContextOps layer

The 10-phase ContextOps roadmap (Phases 1–10, all merged on `main`)
turns Mega Saver from an output compressor into a self-improving
context layer for AI coding agents. Each engine is deterministic — **no
LLM, no embeddings** inside Core; ranking is BM25 + path overlap, and
the calling agent supplies any intelligence. The agent stays the
executor; Mega Saver remembers, indexes, scores, and advises.

| Phase | Engine | What it does | Package · CLI |
|-------|--------|--------------|----------------|
| 1 | **Structured memory (DIMMEM)** | Typed engineering memory (10 `MemoryType`s + confidence/source/keywords/relatedFiles/freshness) — atomic facts an agent never has to re-derive. | `@megasaver/core` · `mega memory` |
| 2 | **Semantic repo index** | Parses the repo into typed `CodeBlock`s (AST for TS/JS/Markdown/JSON) so retrieval works on blocks, not whole files. | `@megasaver/indexer` · `mega scan` / `mega index` |
| 3 | **Context pruning (LAMR)** | Task-aware 8-factor scoring → a 6–8-block context pack with per-block reasons and a dependency closure; named/failing blocks are never silently dropped. | `@megasaver/context-pruner` · `mega context` |
| 4 | **MCP server** | Exposes the engines as MCP tools over `stdio` (the surface grew 4 → 25 across phases). | `@megasaver/mcp-bridge` · `mega mcp` |
| 5 | **Failed-run learning (FORGE)** | Records failed attempts, finds similar past failures, converts a failure into a reusable project rule, and ranks rules applicable to a task. | `@megasaver/core` · `mega fail` / `mega rules` / `mega learn` |
| 6 | **Task engine** | A deterministic plan state machine — typed, dependency-aware `TaskStep`s with **selective retry** (re-run only the failed step and its dependents, never completed work). | `@megasaver/core` · `mega task` |
| 7 | **Tool router** | Given a task, returns a small, relevance-ranked allow-list of safe tools (fewer tool schemas in context) and blocks dangerous/deploy/database tools unconditionally. | `@megasaver/core` · `mega tools` |
| 8 | **Audit dashboard** | One windowed, persisted token-savings summary — files/blocks considered vs included, rules applied, retries saved — answering "this task would've been 70k, was 23k, 67% saved." | `@megasaver/stats` · `mega audit` |
| 9 | **Multi-agent connectors** | Seven flat-file connector targets sharing one project memory; a decision recorded in one agent's session is recalled in another's config file. | `@megasaver/connector-generic-cli` · `mega connector` |
| 10 | **Memory approval** | Agent-suggests → human-approves: `MemoryEntry.approval` gate so only `approved` memory reaches agents and teammates; a team is a shared `--store` plus the gate. | `@megasaver/core` · `mega memory approve` / `mega github pr-comment` |

The full, source-cited phase detail lives in
[`wiki/syntheses/contextops-roadmap.md`](wiki/syntheses/contextops-roadmap.md).

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
│  claude-code · codex · cursor · aider …  │
│  (7 thin adapters)  (stdio · 25 tools)   │
└──────────────┬───────────────────────────┘
               │ public API only
               ▼
┌──────────────────────────────────────────┐
│   @megasaver/core  +  ContextOps engines │
│  Schemas (Zod) · Registry · JSON store   │
│  memory · failed-attempt · rule · task   │
│  tool-router · indexer · context-pruner  │
│  Context Gate: policy · output-filter ·  │
│  content-store · retrieval (BM25) · stats│
└──────────────┬───────────────────────────┘
               │ on-disk
               ▼
        <store>/   (XDG / %LOCALAPPDATA%)
        ├─ projects.json
        ├─ sessions.json
        └─ memory/<projectId>.jsonl
```

**Hard rule:** Core never imports connector or CLI code. The leaf
packages — the five Context Gate ones (`policy`, `output-filter`,
`content-store`, `retrieval`, `stats`) plus the ContextOps `indexer`
and `context-pruner` — must not import core. The DIMMEM / FORGE / task /
tool-router schemas and registry methods live **inside** `@megasaver/core`.
Connectors import Core. The CLI imports Core, connectors, and the
engines. The GUI imports Core directly through a tiny localhost bridge.

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

### Memory (DIMMEM + approval)

```bash
mega memory create  <project> --scope project|session --content <s> [--session <id>]
mega memory list    <project> [--json]                 # includes the approval column
mega memory show    <entry-id> [--json]
mega memory search  <project> --query <s> [--all] [--json]  # --all surfaces unapproved
mega memory update  <entry-id> [--content <s>] [--approval <state>] [--json]
mega memory approve <entry-id> [--json]                # promote a suggested entry
mega memory reject  <entry-id> [--json]
mega memory delete  <entry-id> [--json]
mega memory explain <entry-id> [--json]                # why an entry would be retrieved
```

A human `mega memory create` defaults to `approved`; an agent writing
through `save_memory` defaults to `suggested`. Only `approved` memory
reaches agents and connector files (Phase 10).

### Semantic index (Phase 2)

```bash
mega scan         <project> [--json]                   # list indexable files
mega index build  <project> [--json]                   # parse repo into CodeBlocks
mega index status <project> [--json]
mega index search <project> --query <s> [--json]
mega index show   <block-id> [--json]
```

### Context packs (LAMR, Phase 3)

```bash
mega context build   <project> --task <s> [--failing-test <id>] [--changed-file <p>] [--json]
mega context explain <project> --task <s> [--json]     # per-block, per-factor scores
mega context audit   <project> --task <s> [--json]     # token-savings for the pack
mega context export  <project> --task <s> [--json]
```

### Failed-run learning (FORGE, Phase 5)

```bash
mega fail record <project> --task <s> --error <s> [--related-file <p>] [--json]
mega fail list   <project> [--json]
mega fail show   <attempt-id> [--json]

mega rules list  <project> [--task <s>] [--json]
mega rules add   <project> --title <s> --rule <s> --severity <level> [--json]
mega rules apply <project> --task <s> [--json]         # rank rules for a task

mega learn from-failure <attempt-id> --title <s> --rule <s> --severity <level> [--json]
```

### Task engine (Phase 6)

```bash
mega task plan    <project> --goal <s> [--json]        # author a typed, dependency-aware plan
mega task status  <plan-id> [--json]
mega task step    <plan-id> --step <id> --state running|completed|failed [--json]
mega task retry   <plan-id> --step <id> [--json]       # resets only that step + dependents
mega task explain <plan-id> [--json]
```

### Tool router (Phase 7)

```bash
mega tools add     <project> --name <s> --category <c> --risk <level> [--json]
mega tools list    <project> [--json]
mega tools route   <project> --task <s> [--json]       # {allowedTools, blockedTools, reason}
mega tools explain <project> --task <s> [--json]
```

### Audit dashboard (Phase 8)

```bash
mega audit report  <project> [--window session|week|all] [--json]
mega audit last    <project> [--json]
mega audit session <session-id> [--json]
mega audit export  <project> [--format json]
```

### Connectors

```bash
mega connector sync   <project> [--target <id>] [--json]
mega connector status <project> [--target <id>] [--json]
mega connector list   [--json]                         # known targets, present/absent
mega connector doctor <project> [--target <id>] [--json]  # exists/writable/in-sync
```

### GitHub

```bash
mega github pr-comment <project> [--json]              # render approved memory as a PR comment
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

## MCP tools

`@megasaver/mcp-bridge` is a real MCP server over `stdio` (start it
with `mega mcp serve`). It exposes **25 tools** — a closed enum pinned
by `mcpToolNameSchema` and tuple-ordering `.test-d.ts` tests. The
descriptions below come straight from the bridge's `TOOL_DEFS`.

**Memory (DIMMEM + approval)**

| Tool | Description |
|------|-------------|
| `save_memory` | Write a typed memory entry to a project. |
| `search_memory` | Search project memories by text and filters. |
| `get_relevant_memories` | Rank project memories by relevance to a task. |
| `approve_memory` | Approve or reject a suggested memory entry (human-in-the-loop decision; cannot move a memory back to suggested). |

**Context & retrieval**

| Tool | Description |
|------|-------------|
| `get_project_context` | Project briefing: meta, rules, key memories, index summary, open failures. |
| `get_relevant_context` | Build a task-aware context pack from the project index. |
| `get_relevant_code_blocks` | The included blocks of a task's context pack. |
| `explain_context_selection` | Per-factor scoring for each included context block. |
| `get_context_budget_report` | Token-savings audit for a task's context pack. |
| `mega_read_file` | Read a file through the redact/filter pipeline. |
| `mega_run_command` | Run a policy-gated command and filter its output. |
| `mega_recall` | Recall session memory and stored chunk sets. |
| `mega_fetch_chunk` | Fetch one stored chunk from a chunk set. |

**Rules & failures (FORGE)**

| Tool | Description |
|------|-------------|
| `record_failed_attempt` | Record a failed task attempt for a project. |
| `find_similar_failures` | Rank past failed attempts similar to a task. |
| `convert_failure_to_rule` | Convert a failed attempt into a reusable project rule. |
| `save_project_rule` | Write a reusable project rule. |
| `get_project_rules` | Reusable project rules, optionally filtered by task or files. |
| `get_applicable_rules` | Score project rules applicable to a task or files. |

**Tasks**

| Tool | Description |
|------|-------------|
| `build_task_plan` | Create an ordered, dependency-aware task plan. |
| `record_task_step` | Report a step running/completed/failed; rolls up plan status. |
| `get_task_status` | Plan status, per-step state, and ready steps. |
| `retry_failed_step` | Reset a failed step (and its dependents) to pending. |

**Tool routing & audit**

| Tool | Description |
|------|-------------|
| `route_tools_for_task` | Recommend task-relevant tools; block dangerous/deploy/database. |
| `audit_token_usage` | Summarize recorded token/context savings for a project or session. |

The four `mega_*` tools are the original Context Gate surface; the
other 21 ride on the Phase 1–10 engines.

---

## Connectors

Mega Saver ships **seven** built-in connector targets (Phase 9 added
`gemini`, `windsurf`, and `continue`). Each target reads the same Core
registry and writes to **one** file per target, inside a
sentinel-bounded block. User content outside the block is preserved
verbatim across syncs, and only `approved` memory is rendered.

| Target | File written | Format |
|--------|--------------|--------|
| `claude-code` | `CLAUDE.md` (project root) | Markdown block |
| `codex` | `AGENTS.md` (project root) | Markdown block |
| `cursor` | `.cursor/rules/megasaver.mdc` | Cursor rule with frontmatter |
| `aider` | `CONVENTIONS.md` | Plain markdown (read by Aider via `--read`) |
| `gemini` | `GEMINI.md` (project root) | Markdown block |
| `windsurf` | `.windsurfrules` | Flat-file block |
| `continue` | `.continue/rules/megasaver.md` | Markdown block |

A decision recorded in one agent's session lands byte-identically in
every other agent's file — that is the cross-agent shared-memory proof
of Phase 9. `vscode` / `jetbrains` native IDE plugins and a `mega
connect` alias are deliberately deferred.

`mega connector status` reports one of `in-sync`, `drift`,
`no-block`, `missing`, `error` per target, with byte-symmetric
output across `sync` and `status` (every line carries
`session=<id|none>`). `mega connector list` enumerates the known
targets and whether each file is present; `mega connector doctor`
reports per-target exists / writable / in-sync diagnostics.

Connector packages:

- [`@megasaver/connector-claude-code`](packages/connectors/claude-code)
- [`@megasaver/connector-generic-cli`](packages/connectors/generic-cli)
  — manifest-driven adapter that powers the `codex`, `cursor`, `aider`,
  `gemini`, `windsurf`, and `continue` targets.
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
prefer the four Context Gate MCP tools over native ones —
`mega_read_file`, `mega_run_command`, `mega_fetch_chunk`, and
`mega_recall` (four of the bridge's [25 tools](#mcp-tools)). The bridge
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
│  ├─ core/                      # Engine: schemas, registry, JSON store;
│  │                            #   memory · failed-attempt · rule · task · tool-router
│  ├─ indexer/                   # Semantic repo index — typed CodeBlocks (Phase 2)
│  ├─ context-pruner/           # LAMR task-aware context packs (Phase 3)
│  ├─ context-gate/             # Mega Saver Mode orchestrator (extracted from core)
│  ├─ policy/                    # Command/path gates + redaction
│  ├─ output-filter/            # redact → chunk → rank → fit → summarize
│  ├─ content-store/            # ChunkSet persistence
│  ├─ retrieval/                # BM25 ranking
│  ├─ stats/                     # Per-session token-saver + audit stats
│  ├─ shared/                    # Cross-package contracts (IDs, enums)
│  ├─ mcp-bridge/                # Real MCP stdio server (25 tools)
│  ├─ skill-packs/               # Real pack loader / installer (`mega pack`)
│  └─ connectors/
│     ├─ shared/                 # Block helpers + context schema
│     ├─ claude-code/            # Claude Code connector
│     └─ generic-cli/            # Manifest-driven (codex/cursor/aider/gemini/windsurf/continue)
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
  including the [`contextops-roadmap.md`](wiki/syntheses/contextops-roadmap.md)
  (all 10 phases) and [`post-v1.1-roadmap.md`](wiki/syntheses/post-v1.1-roadmap.md).

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
- **ContextOps roadmap — all 10 phases (PRs #114–#123, 2026-06-12)** —
  Phase 1 DIMMEM structured memory (#114), Phase 2 semantic repo index
  (#115), Phase 3 context pruning / LAMR (#116), Phase 4 MCP server
  full surface (#117), Phase 5 FORGE failed-run learning (#118), Phase 6
  task engine (#119), Phase 7 tool router (#120), Phase 8 audit
  dashboard (#121), Phase 9 multi-agent connectors (#122), and Phase 10
  team / memory-approval (#123). MCP tool surface grew 4 → **25**. See
  [The ContextOps layer](#the-contextops-layer).

### Remaining

1. **npm publish** — `@megasaver/cli` is not yet on npm; needs a
   maintainer to add the `NPM_TOKEN` secret and re-run `release.yml`.
   This is the one MVP → installable-product gap.
2. **GUI native packaging** — revisit Tauri / Electron.
3. **i18n** — product strings are English-only; add `tr` via
   `packages/shared/i18n`.
4. **Deferred cloud-SaaS slice (Phase 10)** — the local memory-approval
   workflow shipped; genuine team/cloud features are deliberately
   deferred and require infra outside `mega`'s local-first, single-binary
   design: hosted sync, an auth service, private deployment, org-level
   rules, a hosted audit service, a web approval UI, and a memory
   `visibility` field.
5. **Deferred connector targets** — native IDE plugins (`vscode`,
   `jetbrains`) and a `mega connect` alias.

Full, source-cited phase detail in
[`wiki/syntheses/contextops-roadmap.md`](wiki/syntheses/contextops-roadmap.md);
the v1.1 cleanup arc lives in
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
