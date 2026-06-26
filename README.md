# Mega Saver

> **A local context engine for AI coding agents.**
> Less tokens. More signal. Same or better agent performance.

Mega Saver sits between your coding agent (Claude Code, Codex, Cursor, Aider, or
any CLI agent) and its tools. When the agent reads a big file, runs a command, or
scans a noisy build log, Mega Saver routes that output through a deterministic
**redact → chunk → rank → fit → summarize** pipeline and hands the model only the
relevant excerpts. The full raw output stays on your disk, one call away.

The result: a 60 KB file read or a 300 KB test log reaches the model as a few
hundred tokens of the parts that actually matter — not the whole wall of text.

**Others prune output. MegaSaver prunes with your project’s memory.** It uses
your structured memory and past failures to decide what's relevant, so the
excerpts it keeps are the ones your current task needs.

Everything runs locally. No database, no account, no cloud. Your code and outputs
never leave your machine.

---

## Table of contents

- [What it does](#what-it-does)
- [Supported agents](#supported-agents)
- [Quick start](#quick-start)
- [Why use it](#why-use-it)
- [How it works](#how-it-works)
- [Proxy tools](#proxy-tools)
- [The `mega` CLI](#the-mega-cli)
- [Connectors](#connectors)
- [Desktop console](#desktop-console)
- [Where your data lives](#where-your-data-lives)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [License](#license)

---

## What it does

- **Compresses tool output.** Large file reads, command runs, and build/test
  logs go through redact → chunk → rank → fit → summarize. Only the relevant
  excerpts reach the model; the full raw output is stored and recoverable.
- **Ranks by what you're working on.** A prompt-capture hook feeds your latest
  request in as ranking intent, so compression keeps the lines about *your* task
  instead of generic ones.
- **Skips unchanged re-reads.** Re-reading a file you already read this session —
  and that hasn't changed — returns a tiny "unchanged" marker instead of the
  whole file again. No wasted tokens, and the prior version is still expandable.
- **Chunks code on real boundaries.** For source files, excerpts are split on
  function / class / heading boundaries (via the project's AST index), not
  arbitrary line counts — so the model sees whole, coherent units.
- **Keeps the evidence.** Nothing is thrown away. Every compressed result points
  at a recoverable chunk set you can expand back to the complete output.
- **Stays out of the way.** Compression is opt-in per session, secrets are
  redacted before anything is stored, and on any error the agent gets the
  original output untouched.

---

## Supported agents

Agents connect to Mega Saver — never the reverse. Each connector is a thin
adapter; the core is agent-agnostic.

| Agent | How it connects | Instruction file written |
|-------|-----------------|--------------------------|
| **Claude Code** | MCP bridge + Pre/PostToolUse + UserPromptSubmit hooks | `CLAUDE.md` |
| **Codex** | MCP bridge | `AGENTS.md` |
| **Cursor** | MCP bridge | `.cursor/rules/megasaver.mdc` |
| **Aider** | conventions file | `CONVENTIONS.md` |
| **Any CLI agent** | `mega output exec` wrapper / MCP | — |

---

## Quick start

Mega Saver needs **Node.js 22+**.

### 1. Install

**Standalone bundle (recommended).** Grab the zero-dependency `mega.mjs` from the
[latest release](https://github.com/haJ1t/MegaSaver/releases/latest):

```bash
curl -fsSL -o mega.mjs \
  https://github.com/haJ1t/MegaSaver/releases/latest/download/mega.mjs
node mega.mjs --help
```

Put it on your `PATH` (e.g. save as `mega`, `chmod +x`) and you can call `mega`
directly.

**From source:**

```bash
git clone https://github.com/haJ1t/MegaSaver.git
cd MegaSaver
pnpm install
pnpm build
node apps/cli/dist-bundle/mega.mjs --help
```

### 2. Connect your agent

Install the MCP bridge and write the connector instruction block for your agent:

```bash
mega mcp install --target claude-code --project myapp
mega connector sync myapp --target claude-code
```

For Claude Code, also install the hooks (telemetry + output saver + prompt
capture):

```bash
mega hooks install claude-code
```

### 3. Turn on compression for a session

```bash
mega session saver enable <session-id> --mode balanced
```

Modes: `safe` (conservative), `balanced` (default), `aggressive` (maximum
savings). Now point your agent at the [`proxy_*` tools](#proxy-tools) instead of
native Read / Bash / grep — or, with hooks installed, native tool output is
compressed automatically.

### 4. Verify

```bash
mega doctor              # checks bridge, hooks, connector blocks
mega hooks status        # shows which hooks are installed + adoption metrics
```

---

## Why use it

- **Cut token spend.** Big reads and logs become small, relevant excerpts —
  typically 60–90% fewer tokens on noisy output, with no loss of recoverable
  detail.
- **Keep agent quality.** Memory- and intent-aware ranking means the model still
  sees the lines it needs to decide. Less noise often *improves* answers.
- **Never lose evidence.** Full raw output is stored locally; expand any chunk
  set back to the complete text on demand.
- **Private by default.** Local-only. Secrets are redacted before storage. No
  account, no telemetry leaving your machine.
- **Works with the agents you already use.** One core, thin connectors. Switch
  agents without re-learning anything.

---

## How it works

```
   your coding agent
        │
        │  reads a file / runs a command / greps
        ▼
  ┌───────────────────────────────────────────────┐
  │  proxy_* tools   or   PostToolUse hook         │   (opt-in per session)
  └───────────────────────────────────────────────┘
        │
        ▼
  ┌───────────────────────────────────────────────┐
  │  local daemon  →  context-gate pipeline        │
  │                                                │
  │   redact  →  chunk  →  rank  →  fit  →  sum     │
  │   (secrets) (AST/    (intent+ (budget) (brief)  │
  │             lines)   memory)                    │
  └───────────────────────────────────────────────┘
        │                          │
        │ relevant excerpts        │ full raw output (lossless)
        ▼                          ▼
   back to the model          on-disk chunk store
                              (expand any time)
```

1. **Capture.** Tool output is captured via the agent's hooks or the `proxy_*`
   tools — only when compression is enabled for that session.
2. **Redact.** Secrets are stripped before anything is stored.
3. **Chunk.** Source files split on AST boundaries (functions, classes,
   headings); everything else splits by lines.
4. **Rank.** Chunks are scored against your task — your captured prompt (intent),
   project memory, and past failures all feed the score.
5. **Fit & summarize.** The top chunks that fit the token budget are returned
   with a short summary and a pointer to expand the rest.
6. **Store.** The complete raw output is saved locally so nothing is ever lost.

A re-read of an unchanged file short-circuits this entirely and returns an
"unchanged" marker pointing at the prior result — zero re-spend.

---

## Proxy tools

When compression is on for a session, point the agent at these instead of its
native tools. Each returns a task-aware summary, ranked excerpts, an expandable
chunk pointer, and savings metrics — while the full output stays on disk.

| Tool | Use instead of | What you get |
|------|----------------|--------------|
| `proxy_read_file` | Read | AST-aware excerpts of the relevant parts; unchanged re-reads suppressed |
| `proxy_run_command` | Bash | compressed command output, full log recoverable |
| `proxy_search_code` | grep / Glob | ranked matches scoped to your task |
| `proxy_expand_chunk` | — | expand any stored chunk back to full text |

Proxy Mode is **opt-in**: nothing is intercepted unless the agent chooses these
tools, and adoption is reported honestly (`mega hooks status`).

---

## The `mega` CLI

```
mega <command> [subcommand] [flags]
```

| Command | What it does |
|---------|--------------|
| `mega mcp` | install / repair / status / serve the MCP bridge for an agent |
| `mega hooks` | install / status / uninstall Claude Code hooks (telemetry, saver, intent) |
| `mega connector` | write & sync the per-agent instruction block; report drift |
| `mega session` | manage sessions and per-session Mega Saver Mode |
| `mega output` | run a command through the compression pipeline (`mega output exec`) |
| `mega proxy` | start the opt-in local token-metering proxy |
| `mega memory` | view & write structured project memory |
| `mega audit` | windowed token-savings summary |
| `mega doctor` | diagnose bridge / hooks / connector setup |

Run `mega <command> --help` for subcommands and flags. Closed-enum flags
(`--target`, `--mode`, `--risk`, `--scope`) take their accepted values straight
from the source, so `--help` always lists exactly what's valid.

Common flags on most commands: `--store <path>` (storage location), `--json`
(machine-readable output), `--mode safe|balanced|aggressive`.

---

## Connectors

Mega Saver writes a per-project instruction block into **one** file per agent,
inside a sentinel-bounded block. Your own content outside the block is preserved
across syncs.

| Target | File written | Format |
|--------|--------------|--------|
| `claude-code` | `CLAUDE.md` (project root) | Markdown block |
| `codex` | `AGENTS.md` (project root) | Markdown block |
| `cursor` | `.cursor/rules/megasaver.mdc` | Cursor rule |
| `aider` | `CONVENTIONS.md` | plain markdown (`--read`) |

```bash
mega connector sync myapp --target claude-code
mega connector status myapp --target claude-code   # in-sync | drift | no-block | missing
```

---

## Desktop console

A localhost web console over the same on-disk store — no terminal required:

```bash
pnpm --filter @megasaver/gui dev   # UI on :5173, bridge on :5174
```

Open <http://localhost:5173>. It shows your **sessions** and **memory entries**
with write actions, an **Agent Setup Doctor** that installs/repairs the bridge
and connector blocks in one click, and a per-session **Token Saver panel** with a
mode picker, savings ratio, a savings-history chart, a recent-events feed, a
raw/sent viewer, and raw-output retention controls. Keyboard-reachable, WCAG AA
contrast.

---

## Where your data lives

Everything is plain JSON / JSONL on disk — no database, no service.

| Path | Contents |
|------|----------|
| `<store>/projects.json` | your projects |
| `<store>/sessions.json` | sessions (incl. Mega Saver Mode settings) |
| `<store>/memory/<projectId>.jsonl` | memory entries, one per line |
| `<store>/content/.../<chunkSetId>.json` | stored raw output (expandable) |

**Default store path:**

- `$XDG_DATA_HOME/megasaver`, else `~/.local/share/megasaver` (macOS / Linux)
- `%LOCALAPPDATA%\megasaver` (Windows)
- override on any command with `--store <path>`

Writes are atomic and durable on POSIX and Windows; on any error the original
file is left untouched.

---

## Configuration

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `MEGASAVER_TOOL_NAMING` | `proxy` \| `legacy` | `proxy` | which MCP tool names are exposed (`proxy_*` vs. `mega_*`) |
| `MEGASAVER_ENGINE_RANKING` | `true` \| unset | off | enable memory + failure-history aware ranking |

An optional `permissions.yaml` in a project tightens the command/path allow-list.
It is **tighten-only** — it can never loosen the built-in safety gates.

---

## Troubleshooting

```bash
mega doctor          # one-shot health check: bridge, hooks, connector blocks
mega hooks status    # which hooks are installed + how often the agent uses the proxy
```

- **Agent isn't using the proxy tools** — confirm Mega Saver Mode is enabled for
  the session (`mega session saver enable <id>`) and the connector block is
  in-sync (`mega connector status`).
- **No compression on native reads** — install hooks (`mega hooks install
  claude-code`) and check `mega hooks status` shows all three installed.
- **Want the full output** — every compressed result ends with a
  `proxy_expand_chunk(<chunkSetId>, "0")` pointer; call it to get the complete
  text.

---

## Project layout

pnpm + Turborepo monorepo.

| Path | Package | Role |
|------|---------|------|
| `apps/cli` | `@megasaver/cli` | the `mega` command |
| `apps/gui` | `@megasaver/gui` | desktop console |
| `packages/core` | `@megasaver/core` | core engine |
| `packages/context-gate` | `@megasaver/context-gate` | read/compress pipeline |
| `packages/output-filter` | `@megasaver/output-filter` | chunk → rank → fit |
| `packages/content-store` | `@megasaver/content-store` | on-disk chunk store |
| `packages/indexer` | `@megasaver/indexer` | AST code index |
| `packages/connectors/*` | connectors | per-agent adapters |
| `packages/daemon` | `@megasaver/daemon` | local request daemon |

---

## License

[MIT](LICENSE) © 2026 Halit Ozger
