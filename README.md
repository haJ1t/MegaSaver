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

## Install

```sh
npm install -g @megasaver/cli
```

Then see your savings in the browser:

```sh
mega gui
```

`mega gui` serves the console on a loopback-only port and opens it in your
browser with a one-time access token — no clone, no `pnpm`, no build. Add
`--no-open` to just print the URL, `--port <n>` to pin the port.

Or download the self-contained `mega.mjs` bundle from
[GitHub Releases](https://github.com/haJ1t/MegaSaver/releases/latest).
Full setup guide (prerequisites, hooks, first session): **[docs/getting-started.md](docs/getting-started.md)**.

## Benchmarks

90–99% token reduction on common agent workloads — re-reads of unchanged
files, large JSON, noisy logs, outline-first reads, and session context replay —
all lossless via ChunkSet (full raw output recoverable on demand).
See **[docs/benchmarks.md](docs/benchmarks.md)** for the full table.

---

## Table of contents

- [What it does](#what-it-does)
- [Supported agents](#supported-agents)
- [Quick start](#quick-start)
- [Why use it](#why-use-it)
- [How it works](#how-it-works)
- [Token Saver](#token-saver)
- [Memory](#memory)
- [Proxy tools](#proxy-tools)
- [The `mega` CLI](#the-mega-cli)
- [Connectors](#connectors)
- [Desktop console](#desktop-console)
- [Where your data lives](#where-your-data-lives)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Pro](#pro)
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

**Standalone bundle (recommended).** Grab the self-contained `mega.mjs` from the
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

## Token Saver

Token Saver is the compression half of Mega Saver: it shrinks the **tool and
command output** an agent reads — big file reads, command runs, noisy build/test
logs — down to the lines that matter for what you're doing, and keeps the full
raw output on disk one call away. Nothing is ever thrown away.

### Two ways to turn it on

There are **two independent switches** — installing the hook does nothing on its
own:

1. **Automatic (the main path).** A Claude Code PostToolUse hook compresses every
   eligible tool result in-session. Needs *both* `mega hooks install` **and**
   `mega session saver workspace enable`.
2. **Manual verbs.** `mega output file|filter|exec` run the same pipeline by hand
   on a file or a command — no hook required.

### Modes

Each mode is a per-tool-output **byte budget**. Output at or under the budget is
passed through untouched; only larger output is compressed down to fit.

| Mode | Budget / tool output | Use when |
|------|----------------------|----------|
| `aggressive` | 4 000 B | tightest context, maximum savings |
| `balanced` | 12 000 B | everyday use — the workspace gate's default |
| `safe` | 32 000 B | keep more raw context, compress only the giants |

### The pipeline

Every compression — hook or manual — runs one deterministic pipeline:
**classify → rank → dedupe → fit → summarize**.

- **classify** the output kind (vitest, typescript, diff, JSON, prose, shell, …),
- **rank** lines by your `--intent` (in a live session the UserPromptSubmit hook
  feeds your latest prompt in as intent automatically),
- **dedupe** near-identical lines (simhash),
- **fit** the result under the mode budget,
- **summarize** into a short header plus the top excerpts.

The full original is always written as a recoverable **chunk-set**, and the
returned text carries a pointer:

```text
[Mega Saver: compressed 29490→9001 B (~7372→2250 tokens, 69.5%).
 Full output recoverable — call mega output chunk <chunkSetId> 0]
```

Recover it any time with `mega output chunk <chunkSetId> <chunkId>` (or the MCP
`proxy_expand_chunk` tool). Only **read/observe** tools are compressed — Read, LS,
Bash, Grep, Glob, WebFetch; Write/Edit and MCP calls are left alone.

### Turn on automatic compression (Claude Code)

```bash
mega hooks install claude-code                        # wire Pre/PostToolUse + intent hooks
mega session saver workspace enable --mode balanced   # flip the gate the hook reads (run in your project)
# …use Claude Code normally; large tool outputs come back compressed…
mega output chunk <chunkSetId> 0                       # pull the full text back when you need it
mega session saver workspace disable                  # pause compression
mega hooks uninstall claude-code                       # remove entirely
```

The hook is **fail-open**: on any error it emits nothing and the agent keeps the
original output — a tool call is never blocked, delayed, or aborted. The context
daemon (`mega daemon serve`) is optional; the hook falls back to in-process
compression if it isn't running.

### Compress something by hand

```bash
mega project create demo
mega session create demo --agent claude-code          # note the session id
mega output file <sessionId> ./build.log --intent "find the failing test"
mega output filter <sessionId> --file ./build.log --intent "type errors"
mega output exec <sessionId> --intent "test failures" -- pnpm test   # runs it, keeps relevant lines, mirrors exit code
```

`output file/filter` sandbox the path to your project / cwd / home. `output exec`
is **fail-closed** — the command after `--` must be allowlisted in the project's
`permissions.yaml`, or it is denied and never spawned.

### Measure what you saved

```bash
mega session saver stats <sessionId>   # per-session bytes + token-weighted reduction
mega audit report <project>            # project savings dashboard (--window session|week|all)
mega audit honest <sessionId>          # conservative token-weighted view (anti-vanity metric)
mega hooks status <sessionId>          # adoption + hook interception rate
```

Byte-savings % is the headline; `audit honest` reports the token-weighted
reduction over only the mediated context and warns when that fraction is too
small to imply whole-session savings.

For task-scoped **context-pack** pruning (which files/blocks a task actually
needs), `mega context audit <project> --task "fix login bug" --changed-file
src/auth.ts` reports files and blocks included vs considered and tokens
before → after.

### Meter tokens without compressing (opt-in proxy)

```bash
mega proxy start                                  # transparent forwarding proxy, counts tokens only
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787   # point your agent at it
```

The proxy records per-call token **counts** to `<store>/proxy-usage/usage.jsonl`
— never prompts, responses, or keys — and does **not** compress conversation
context in v1.2. It is inert unless you point an agent at it; Mega Saver never
proxies by default.

---

## Memory

Memory is a **per-project store of durable facts** — decisions, bugs, gotchas,
conventions — that agents recall across sessions. Every entry is a typed,
human-approved record, and only approved, current, non-stale entries reach an
agent's recall, so an agent can't quietly teach itself something you never
signed off on.

### Anatomy of a memory

| Field | Meaning |
|-------|---------|
| `type` | `decision`, `bug`, `architecture`, `todo` (default), `user_preference`, `failed_attempt`, `code_pattern`, `project_rule`, `dependency`, `test_behavior` |
| `scope` | `project` (whole project) or `session` (tied to one session id) |
| `content` / `title` | the fact (single line) and a short label |
| `keywords[]` | lexical search terms |
| `confidence` | `low` / `medium` (default) / `high` — feeds ranking weight (0.34 / 0.67 / 1.0) |
| `source` | `manual` / `agent` / `test_failure` / `git_diff` / `session_summary` |
| `approval` | `suggested` → `approved` / `rejected` (the gate) |
| `relatedFiles[]` / `relatedSymbols[]` | links that build the memory graph |
| `tier` | `working` / `recall` (default) / `archival` |
| validity | bi-temporal — `createdAt`/`updatedAt` (when recorded) vs `validFrom`/`validTo` (when true in the world); `supersedesId` replaces an older fact |

### The approval gate

Recall is **human-gated**:

- Agents and `from-session` distillation stage new memories as `suggested`.
- A human runs `mega memory review <project>` to see the queue, then
  `mega memory approve <id>` or `mega memory reject <id>`.
- Only `approved` (and current, non-stale, non-archival) entries are shared with
  agents. Rejected ones are kept for audit, never shared.

> Memories you create directly with `mega memory create` are written
> **already-approved** — the gate exists for agent/MCP saves and `from-session`,
> not for your own hand-entered facts.

### Commands

| Command | Does |
|---------|------|
| `mega memory create <project> --scope <s> --content <text>` | add an entry (flags below) |
| `mega memory list <project>` | list all entries, any state |
| `mega memory show <id>` | core fields of one entry |
| `mega memory search <project> [query]` | **BM25** lexical search + age/confidence/tier ranking |
| `mega memory update <id> …` | edit mutable fields (`--keyword`/`--file` **replace** the list) |
| `mega memory approve <id>` / `reject <id>` | the human approval decision |
| `mega memory review <project>` | the suggested + rejected triage queue |
| `mega memory explain <id>` | every field + the validation sidecar (audit view) |
| `mega memory delete <id> --yes` | permanent delete (destructive, no undo) |
| `mega memory index <project>` | build/refresh the semantic index (below) |
| `mega memory sweep <project>` | demote aged / closed / stale / low-value entries to `archival` |
| `mega memory from-session <sessionId>` | distill a session's failures into `suggested` memories |
| `mega memory graph <project>` | print the memory graph (nodes + conflict/supersede edges) |

`create` flags: `--scope` (required), `--content` (required), `--session`,
`--type`, `--title`, `--keyword` (repeatable), `--confidence`, `--source`,
`--reason`, `--goal`, `--file` (repeatable), `--expires`. Add `--store <dir>` to
any command for a non-default store, `--json` for machine output.

### Semantic recall (optional)

`mega memory search` is **pure BM25** (lexical over title + content + keywords).
Richer recall — for agents, task-scoped relevance, and near-duplicate detection —
comes from an **embedding index**:

```bash
mega memory index <project>   # embeds new/changed entries, carries unchanged ones forward
```

This uses the optional `@huggingface/transformers` stack
(`Xenova/all-MiniLM-L6-v2`, ~50 MB on first run). It is an **optional native
dependency** (v1.2.1): where the platform binary can't install, embedding fails
and everything **degrades cleanly to BM25** — search, task relevance (otherwise
ranks memory files by cosine relevance to your task, top-K above a floor), and
the near-duplicate check all keep working without it.

On the MCP `approve` path a best-effort pass surfaces existing memories
≥ 0.95 cosine-similar as **near-duplicates** — advisory only; it never
auto-merges. You canonicalize by re-approving with `supersedesId`.

### Lifecycle: tiers, decay, supersession

- **Tiers & decay.** Ranking uses `confidence × ageDecay × tierWeight`, where
  ageDecay is exponential (30-day half-life) and only ever down-ranks — it never
  drops a memory or mutates its stored confidence. `working` gets a small boost;
  `archival` is hidden from default recall.
- **Sweep.** `mega memory sweep` is the only tier mutation — on-demand, lossless
  (sets tier, never deletes), idempotent. Nothing archives until you run it.
- **Retire vs delete.** `mega memory update <id> --stale` hides an entry from
  default search (reversible with `--no-stale`); `mega memory delete <id> --yes`
  is permanent.
- **Bi-temporal validity.** `validFrom`/`validTo` model when a fact is true;
  `supersedesId` replaces an older memory and (on MCP approve) closes its
  `validTo`. The graph emits supersede / duplicate / conflict edges.

Memories live as JSONL at `<store>/memory/<projectId>.jsonl`, with embedding
sidecars alongside — see [Where your data lives](#where-your-data-lives).

### Everyday recipes

```bash
# record a decision (written already-approved)
mega memory create app --scope project --type decision --confidence high \
  --content "auth tokens use <= not < for expiry" --keyword auth --file src/auth.ts

# triage what agents proposed, then approve the good ones
mega memory review app
mega memory approve <id>

# turn on semantic recall, then keep the store lean
mega memory index app
mega memory sweep app
```

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
| `mega gui` | serve the desktop console locally (loopback + token) and open it |
| `mega mcp` | install / repair / status / serve the MCP bridge for an agent |
| `mega hooks` | install / status / uninstall Claude Code hooks (telemetry, saver, intent) |
| `mega connector` | write & sync the per-agent instruction block; report drift |
| `mega session` | manage sessions and per-session Mega Saver Mode |
| `mega output` | run a command through the compression pipeline (`mega output exec`) |
| `mega proxy` | start the opt-in local token-metering proxy |
| `mega memory` | view & write structured project memory |
| `mega audit` | windowed token-savings summary |
| `mega license` | activate / status / deactivate a Mega Saver Pro license |
| `mega savings` | historical savings analytics + export (Pro) |
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
mega gui   # serves the console + opens it with a one-time token
```

`mega gui` binds loopback-only and gates every `/api` call behind a per-run
bearer token (handed to the browser once via the opened URL, then stripped
from the address bar). Use `--no-open` to print the URL instead, `--port <n>`
to pin the port, `--store <dir>` to point at a non-default store.

Contributors working on the console itself run the split dev servers instead
(`pnpm --filter @megasaver/gui dev` — UI on :5173, bridge on :5174).

The console shows your **sessions** and **memory entries**
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

## Pro

The core CLI is free and MIT — the whole compression, memory, and audit pipeline
above works with no account and no key. **Mega Saver Pro** unlocks new features
that were never part of the free tier, starting with **historical savings
analytics**: time-series savings trends, a per-project breakdown, and CSV/JSON
export.

```sh
mega license activate <key>       # activate a Pro key
mega license status               # Pro (active) or no license (free)

mega savings history              # savings per day (Pro)
mega savings history --by week    # or per ISO week
mega savings history --by project # per-project breakdown
mega savings history --json       # or --csv, or --out <file>
mega savings export --format csv --out savings.csv

mega savings insights             # where tokens are still spent (Pro)
mega savings insights --by label  # or break down by tool/label

mega savings forecast             # project this period's savings (Pro)
mega savings forecast --goal $15  # pace it against a savings goal
```

- `mega savings insights [--by source|label]` — where your tokens are still
  going: a waste breakdown by source/tool, with per-source saving ratios.
- `mega savings forecast [--goal $15]` — projects this period's savings by
  run-rate (labeled an estimate) and paces it against an optional goal.

Without a license, `mega savings` prints a one-line note that the feature is Pro
and exits cleanly — it never errors, and the free CLI is unaffected. Keys are
issued manually until billing lands (the Sublime / Obsidian model).

### Honesty disclosure

We are open about what the license does and does not do:

- **The gate is bypassable.** The entitlement check (`checkEntitlement`) lives in
  MIT/open-source code, so anyone can edit the source to remove it. That is
  inherent to open-core, and we do not pretend otherwise or ship security
  theater.
- **The license is not forgeable.** Keys are Ed25519-signed by a private key held
  offline by the vendor and verified against a public key baked into the CLI. The
  signature makes fake keys impossible; verification is fully offline (no network,
  no telemetry) and **fail-closed** — anything tampered, expired, or wrong-key
  resolves to "not entitled".

Honest users pay for a real key; the gate makes piracy a deliberate license
violation rather than an accident. The proprietary Pro logic lives in
`@megasaver/pro-analytics` (see [License](#license)).

---

## License

The CLI and every package it is built from are [MIT](LICENSE) © 2026 Halit Ozger,
**except** the Pro module `@megasaver/pro-analytics`, which is proprietary and
source-available under its own [`packages/pro-analytics/LICENSE`](packages/pro-analytics/LICENSE):
use requires a valid Mega Saver Pro license; no redistribution.

> **Packaging note (mixed license).** The published `@megasaver/cli` bundle is
> built with `tsup --config tsup.bundle.config.ts` (`noExternal: [/.*/]`), which
> inlines every workspace dependency — including `@megasaver/pro-analytics` — into
> the single-file `mega.mjs`. So the proprietary Pro logic ships inside the
> otherwise-MIT tarball. This is a deliberate, disclosed trade-off for the initial
> release: the gate is bypassable anyway (see [Pro](#pro)), and shipping one bundle
> keeps install trivial. A clean split (externalizing `@megasaver/pro-analytics`
> into its own paid package, or a Pro-only bundle) is a **deferred refinement**.
