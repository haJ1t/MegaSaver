# Mega Saver

> **ContextOps for coding agents.**
> Less tokens. More signal. Same or better agent performance.

Mega Saver is a single control panel for context, memory, sessions, and
token efficiency across modern coding agents — Claude Code, Codex,
Cursor, Aider, and any CLI agent. Your agents connect to Mega Saver; it
manages the expensive, fragile parts of context so the model sees signal
instead of noise — and the raw evidence stays on your disk.

**Others prune output. MegaSaver prunes with your project’s memory.**

---

## Table of contents

- [What it does](#what-it-does)
- [Install](#install)
- [Quickstart](#quickstart)
- [The `mega` CLI](#the-mega-cli)
- [Proxy Mode](#proxy-mode)
- [Connectors](#connectors)
- [Desktop / GUI console](#desktop--gui-console)
- [Where your data lives](#where-your-data-lives)
- [Configuration](#configuration)
- [License](#license)

---

## What it does

- **Compresses tool output.** Big file reads, command runs, and
  build/test logs are routed through a deterministic
  redact → chunk → rank → fit → summarize pipeline. Only the relevant
  excerpts reach the model; the full raw output stays on disk and is one
  call away when you need it.
- **Prunes with your project's memory.** Unlike a generic text filter,
  Mega Saver uses your project's structured memory and past failures to
  decide what matters — so the excerpts it keeps are the ones your task
  actually needs.
- **One persistent store** for projects, sessions, and memory entries
  that any connected agent can read or write.
- **Honest, measurable savings.** Every routed call records raw vs.
  returned bytes and a savings ratio, shown live in the GUI and CLI.
- **Works everywhere.** macOS, Linux, and Windows. Plain JSON on disk —
  no database, no daemon, no account.

What Mega Saver is **not**: not a model proxy or token blinder (it
preserves the evidence the model needs to decide), and not a team
chatops tool (single-developer first).

---

## Install

### Standalone binary (recommended)

The `mega` CLI ships as a single self-contained file — every dependency
inlined, no `node_modules`, **Node 22+** the only requirement.

```bash
# Download the latest release and run it
curl -fsSL -o mega.mjs \
  https://github.com/haJ1t/MegaSaver/releases/latest/download/mega.mjs
node mega.mjs doctor

# Or put it on your PATH as `mega`
chmod +x mega.mjs
mv mega.mjs ~/.local/bin/mega
mega doctor
```

The file carries a `#!/usr/bin/env node` shebang, so once it's
executable and on your PATH it runs as `mega`.

### From source

```bash
git clone https://github.com/haJ1t/MegaSaver.git
cd MegaSaver
corepack enable          # pnpm 9.x
pnpm install
pnpm --filter @megasaver/cli build
alias mega="node $PWD/apps/cli/dist/cli.js"
mega doctor
```

> npm install (`npm i -g @megasaver/cli`) lands once the package is
> published; until then use the release binary above.

---

## Quickstart

```bash
# 1. Create a project
mega project create demo

# 2. Open a session
mega session create demo --agent claude-code --title "first session"

# 3. Add a memory entry the agent will see
mega memory create demo --scope project \
  --content "Prefers TypeScript strict mode and Vitest."

# 4. Write the connector block into the project's CLAUDE.md
mega connector sync demo --target claude-code

# 5. Turn on Mega Saver Mode for the session
mega session saver enable <session-id> --mode balanced
```

Every read/write command accepts `--json` for scripting and agent use;
text output is the default for humans. Run `mega doctor` anytime to
check your Node version, store path, and connector status.

---

## The `mega` CLI

```bash
# Projects & sessions
mega project create <name> [--root <dir>]
mega project list
mega session create <project> --agent <id> [--risk low|medium|high|critical] [--title <s>]
mega session list <project>
mega session show <session-id>
mega session update <session-id> [--title <s>] [--risk <level>] [--agent <id>]
mega session end <session-id>

# Memory
mega memory create <project> --scope project|session --content <s> [--session <id>]
mega memory list <project>
mega memory show <entry-id>

# Connectors (write per-agent config blocks)
mega connector sync <project> [--target claude-code|codex|cursor|aider]
mega connector status <project> [--target <id>]

# Mega Saver Mode / Proxy Mode
mega session saver enable <session-id> --mode safe|balanced|aggressive
mega session saver disable <session-id>
mega session saver status <session-id>
mega session saver stats <session-id>          # raw / returned / saved totals

mega output file   <session-id> --intent <s> <path>     # policy-gated read + filter
mega output filter <session-id> --intent <s> --file <log>
mega output exec   <session-id> --intent <s> -- <cmd…>   # run a command, filter its output
mega output chunk  <chunk-set-id> <chunk-id>            # expand a stored excerpt

# MCP bridge (connect an agent to Mega Saver)
mega mcp install|repair|status|uninstall [--target <id>] [--project <name>]
mega mcp serve

# Proxy Mode adoption metrics + Claude Code telemetry hook
mega hooks install claude-code
mega hooks status

# Skill packs
mega pack install <path> [--force]
mega pack list
mega pack info <name>
mega pack remove <name>
```

Closed-enum flags (`--agent`, `--risk`, `--scope`, `--target`,
`--mode`) take their help text and error messages straight from the
source schema, so the accepted values are always exactly what the help
shows.

---

## Proxy Mode

Proxy Mode is the public face of Mega Saver Mode. When it's on for a
session, point your agent at the `proxy_*` MCP tools instead of native
Read / Bash / grep, and Mega Saver returns task-aware summaries,
relevant excerpts, expandable chunks, and savings metrics — while the
full raw output stays on disk.

Proxy Mode is **opt-in**: nothing is intercepted unless the agent
chooses the proxy tools, and adoption is reported honestly.

### Turn it on

In the GUI: open **Sessions**, pick one, click **Enable Mega Saver
Mode**, choose a mode. In one step it writes the session settings, syncs
the connector instruction block, installs/repairs the MCP bridge, and
initializes stats. From the CLI:

```bash
mega session saver enable <session-id> --mode balanced
mega mcp install --target claude-code --project <name>
mega connector sync <name> --target claude-code
```

### The proxy tools

| Tool | Use instead of | What you get |
|------|----------------|--------------|
| `proxy_read_file` | reading a whole file | Redacted, ranked excerpts within a byte budget |
| `proxy_run_command` | `Bash` | Policy-gated run; compressed output (test/typecheck logs collapse to the failures that matter) |
| `proxy_search_code` | `grep` / native search | Matches grouped by file, noise collapsed, ranked by your task |
| `proxy_expand_chunk` | — | Pull back any omitted excerpt when you need the full detail |

Two **naming modes** are available so a token-saving product never
wastes context on duplicate tool schemas — only one name per tool is
ever listed:

```bash
MEGASAVER_TOOL_NAMING=proxy    # default: proxy_read_file, proxy_run_command, …
MEGASAVER_TOOL_NAMING=legacy   # the original mega_* names, for existing setups
```

### Smarter compression for tests & types

Mega Saver recognizes Vitest and TypeScript (`tsc`) output and
compresses it specially — keeping failing tests, assertions, stack
traces, file/line numbers, and grouped compiler errors while collapsing
passing tests and cascading duplicates. Small outputs pass through
untouched (a wrapper would cost more than it saves), so you only pay for
compression when there's something to save.

### Memory-aware ranking (opt-in)

Turn on engine-aware ranking to let your project's memory and past
failures lift the most relevant excerpts:

```bash
MEGASAVER_ENGINE_RANKING=true
```

This re-weights ranking with a memory boost and a failure-history boost
on top of base relevance. It's off by default; flip it on per your
preference.

### Measure adoption honestly

```bash
mega hooks status
```

shows your **proxy adoption rate** (proxy calls vs. all Mega Saver
calls). For Claude Code you can also install an optional telemetry hook
that records native tool-call *metadata only* (never file contents),
which unlocks a **hook-based interception rate** — how often the agent
reaches for proxy tools vs. native ones:

```bash
mega hooks install claude-code
```

Without the hook installed, only the adoption rate is shown (with a hint
to install the hook) — the interception rate is never guessed or
overstated.

### Modes

Each mode caps the bytes returned per call:

| Mode | Returned-byte budget | Use when |
|------|----------------------|----------|
| `safe` | 32 000 | You want more context retained; exploratory work. |
| `balanced` | 12 000 | Default. Strong savings, ample signal. |
| `aggressive` | 4 000 | Maximum savings; tight, focused tasks. |

### Nothing is lost

Compression never deletes evidence. For any event you can open the
**raw** captured output and the **sent** excerpts side by side in the
GUI, or expand a chunk from the CLI. Ask for raw bytes only when the
filtered result is genuinely insufficient. Every command is gated
through the policy allow/deny list and secrets are redacted before
anything is stored or returned.

---

## Connectors

Mega Saver writes a per-project instruction block into **one** file per
agent, inside a sentinel-bounded block. Your own content outside the
block is preserved across syncs.

| Target | File written | Format |
|--------|--------------|--------|
| `claude-code` | `CLAUDE.md` (project root) | Markdown block |
| `codex` | `AGENTS.md` (project root) | Markdown block |
| `cursor` | `.cursor/rules/megasaver.mdc` | Cursor rule |
| `aider` | `CONVENTIONS.md` | Plain markdown (`--read`) |

`mega connector status` reports `in-sync`, `drift`, `no-block`,
`missing`, or `error` per target.

---

## Desktop / GUI console

A localhost web console over the same store:

```bash
pnpm --filter @megasaver/gui dev   # boots the UI (5173) + bridge (5174)
```

Open <http://localhost:5173>. It shows **Sessions** and **Memory
entries** with write actions, an **Agent Setup Doctor** that
installs/repairs the MCP bridge and connector blocks with no terminal,
and a per-session **Token Saver panel** — mode picker, savings ratio, a
savings-history chart, a recent-events feed, a raw/sent viewer, and
raw-output retention controls. Keyboard-reachable, WCAG AA contrast.

---

## Where your data lives

Everything is plain JSON / JSONL on disk — no database, no service.

| Path | Contents |
|------|----------|
| `<store>/projects.json` | Your projects |
| `<store>/sessions.json` | Sessions (incl. Mega Saver Mode settings) |
| `<store>/memory/<projectId>.jsonl` | Memory entries, one per line |

**Default store path:**

- `$XDG_DATA_HOME/megasaver`, else `~/.local/share/megasaver` (macOS / Linux)
- `%LOCALAPPDATA%\megasaver` (Windows)
- override on any command with `--store <path>`

Writes are atomic and durable on both POSIX and Windows; on any error
the original file is untouched.

---

## Configuration

Environment variables you can set:

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `MEGASAVER_TOOL_NAMING` | `proxy` \| `legacy` | `proxy` | Which MCP tool names are exposed (`proxy_*` vs. `mega_*`). |
| `MEGASAVER_ENGINE_RANKING` | `true` \| unset | off | Enable memory + failure-history aware ranking. |

Per-command: `--store <path>` (storage location), `--json` (machine
output), `--mode safe\|balanced\|aggressive` (savings level).

Optional `permissions.yaml` in a project tightens the command/path
allow-list (tighten-only — it can never loosen the built-in safety
gates).

---

## License

[MIT](LICENSE) © 2026 Halit Ozger
