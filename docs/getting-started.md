# Getting Started with Mega Saver

## Prerequisites

- **Node.js 22 LTS** — required. Check with `node --version`; upgrade via
  [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22 && nvm use 22`) or
  the official installer.
- A supported AI coding agent: Claude Code, Codex, Cursor, Aider, Gemini,
  Windsurf, Continue, or any CLI agent.

## Install

### npm (once published to npm)

```sh
npm install -g @megasaver/cli
```

> **Note:** npm publishing requires the `NPM_TOKEN` repo secret and
> `@megasaver` npm org ownership. See
> [RELEASING.md](RELEASING.md) for the maintainer one-time setup. Once
> that secret is set, every `v*` tag auto-publishes via
> `.github/workflows/release.yml`.

### Standalone bundle (available now)

Download `mega.mjs` from the [GitHub Releases](https://github.com/your-org/megasaver/releases)
page and run it directly with Node 22:

```sh
node mega.mjs --version
```

Or put it somewhere on your `$PATH` and alias it:

```sh
alias mega="node /path/to/mega.mjs"
```

## See your savings

```sh
mega gui
```

`mega gui` serves the desktop console (sessions, memory, the Token Saver
panel with the savings chart) on a loopback-only port and opens it in your
browser with a one-time access token — no clone, no `pnpm`, no build. It
runs in the foreground; press Ctrl-C to stop. Flags: `--no-open` prints the
URL instead of opening a browser, `--port <n>` pins the port, `--store <dir>`
points at a non-default store.

## First run

### 1. Install hooks (Claude Code)

Wire Mega Saver's PreToolUse / PostToolUse / UserPromptSubmit hooks into
Claude Code's settings:

```sh
mega hooks install claude-code
```

This writes three hooks into `~/.claude/settings.json` (or the local
`.claude/settings.json` found by Claude Code):

- **PreToolUse** — captures tool name and intent for ranking.
- **PostToolUse** — feeds output through the compression pipeline.
- **UserPromptSubmit** — records your latest prompt as ranking intent.

Verify with:

```sh
mega hooks status <session-id>
```

or the environment check:

```sh
mega doctor
```

### 2. Create a project and session

```sh
mega project create my-project          # register the project
mega session create my-project          # create a session (prints a UUID)
```

### 3. Enable Mega Saver Mode

```sh
mega session saver enable <session-id> --mode balanced
```

Modes: `safe` (conservative, outline-only on big files) | `balanced`
(default, all filters active) | `aggressive` (maximum compression).

### 4. Verify setup

```sh
mega doctor
mega hooks status <session-id>
```

`doctor` checks Node version, platform, and hook telemetry installation.
`hooks status` shows live proxy adoption rate, tool-type breakdown, and
compression metrics for the session.

## Claude Desktop / any MCP client

If your agent supports MCP natively (Claude Desktop, Cursor, Windsurf,
Codex, Gemini, Continue), install the MCP server instead of (or in
addition to) hooks:

```sh
mega mcp install --target claude-code   # or cursor, codex, gemini, etc.
mega mcp serve                          # run the bridge over stdio
```

The MCP bridge exposes the same proxy tools (`proxy_read_file`,
`proxy_run_command`, `proxy_search_code`, `proxy_expand_chunk`) as
tool-resident functions available to any MCP-aware client. The session
saver and output pipeline work identically in either mode.

## How it works

Mega Saver is an agent-agnostic context engine. It connects to your
coding agent via MCP and/or CLI hooks — the agent calls Mega Saver's
proxy tools instead of (or before) native file/command tools. Every
call passes through a deterministic **redact → chunk → rank → fit →
summarize** pipeline that returns only the excerpts relevant to your
current intent. The full raw output is stored locally as a **ChunkSet**
— nothing is discarded, and any excerpt is recoverable with
`proxy_expand_chunk` or `mega output chunk`. The compression is
lossless in this sense: 90–99% of tokens are saved on common inputs
while every byte of the original stays on disk, one call away.
