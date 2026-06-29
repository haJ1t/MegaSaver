# Mega Saver CLI Reference

All commands accept `--store <dir>` to override the default store directory
and `--json` to emit machine-readable JSON output, unless noted.

---

## `mega project`

Manage Mega Saver projects. A project maps a name to a root directory.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `create` | `mega project create <name> [--root <dir>]` | Create a new project. Defaults `--root` to the current directory. |
| `list` | `mega project list` | List all persisted projects. |

**Examples:**

```sh
mega project create my-app
mega project create my-app --root /path/to/repo
mega project list --json
```

---

## `mega session`

Manage Mega Saver sessions. A session tracks one agent conversation.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `create` | `mega session create <project> [--agent <id>] [--risk <level>] [--title <text>]` | Create a session. Prints the session UUID. |
| `list` | `mega session list [<project>]` | List sessions, optionally filtered by project. |
| `show` | `mega session show <session-id>` | Show full details for a session. |
| `end` | `mega session end <session-id>` | Mark a session as ended. |
| `update` | `mega session update <session-id> [--title <text>] [--risk <level>]` | Update session metadata. |

`--agent` accepts: `aider | claude-code | codex | continue | cursor | gemini | generic-cli | windsurf`.

`--risk` accepts: `low | medium | high | critical`. Default: `medium`.

**Examples:**

```sh
mega session create my-app --agent claude-code --risk medium
mega session list my-app
mega session show abc123
mega session end abc123
```

### `mega session saver`

Enable and manage Mega Saver Mode (compression pipeline) on a session.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `enable` | `mega session saver enable <session-id> [--mode <mode>]` | Enable Mega Saver Mode. |
| `disable` | `mega session saver disable <session-id>` | Disable Mega Saver Mode. |
| `status` | `mega session saver status <session-id>` | Show current saver state. |
| `stats` | `mega session saver stats <session-id>` | Show compression statistics. |
| `workspace` | See subcommands | Enable/disable workspace-level saver overlay. |

`--mode` accepts: `safe | balanced | aggressive`. Default: `balanced`.

**Examples:**

```sh
mega session saver enable abc123 --mode balanced
mega session saver status abc123
mega session saver disable abc123
```

---

## `mega output`

Filter and chunk tool output through the compression pipeline.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `file` | `mega output file <session-id> <path> [--intent <text>]` | Filter an on-disk file through the two-gate pipeline. |
| `filter` | `mega output filter <session-id> [--file <path>] [--intent <text>]` | Filter an existing log file through the pipeline. |
| `exec` | `mega output exec <session-id> -- <cmd> [args...] [--intent <text>] [--timeout <sec>] [--max-bytes <n>]` | Run a policy-gated command and filter its combined output. Default timeout: 300 s. |
| `chunk` | `mega output chunk <chunk-set-id> <chunk-id>` | Return a single raw chunk from a stored ChunkSet. |

`--intent` is required for `file`, `filter`, and `exec` — it drives ranking.

**Examples:**

```sh
mega output file abc123 ./src/main.ts --intent "find the auth middleware"
mega output exec abc123 -- pnpm test --intent "why are tests failing"
mega output chunk 27e2be15-7a52-47d1-b8d8-9504d1586efd 0
```

---

## `mega hooks`

Manage Claude Code telemetry hooks and view proxy adoption metrics.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `install` | `mega hooks install claude-code [--settings <path>]` | Install PreToolUse + PostToolUse + UserPromptSubmit hooks. |
| `uninstall` | `mega hooks uninstall claude-code [--settings <path>]` | Remove the hooks. |
| `status` | `mega hooks status <session-id> [--hook-log <path>]` | Show proxy adoption rate and (if hook log present) interception rate. |
| `log` | `mega hooks log` | Show the hook telemetry log. |
| `saver` | See subcommands | Hook-level saver controls. |
| `intent` | `mega hooks intent` | Show or set the current intent captured from hooks. |

**Examples:**

```sh
mega hooks install claude-code
mega hooks status abc123
mega hooks uninstall claude-code
```

---

## `mega connector`

Manage Mega Saver connector targets (agent config files).

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `sync` | `mega connector sync <project> [--target <id>]` | Write Mega Saver context blocks into agent files. |
| `status` | `mega connector status` | Show current sync state for all targets. |
| `list` | `mega connector list` | List known connector targets. |
| `doctor` | `mega connector doctor` | Diagnose connector configuration issues. |

`--target` accepts: `claude-code | codex | cursor | aider | gemini | windsurf | continue`.

**Examples:**

```sh
mega connector sync my-app
mega connector sync my-app --target claude-code
mega connector status
```

---

## `mega mcp`

Manage the Mega Saver MCP server installation.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `install` | `mega mcp install --target <agent-id>` | Install the MCP server into an agent's config file. |
| `uninstall` | `mega mcp uninstall --target <agent-id>` | Remove the MCP server from an agent's config file. |
| `status` | `mega mcp status [--project <name>]` | Report per-agent MCP install state. |
| `repair` | `mega mcp repair --target <agent-id> --project <name>` | Install MCP config and re-sync the connector block. |
| `serve` | `mega mcp serve [--store <dir>]` | Run the Mega Saver MCP bridge over stdio (long-running). |

**Examples:**

```sh
mega mcp install --target claude-code
mega mcp status
mega mcp serve
mega mcp repair --target cursor --project my-app
```

---

## `mega daemon`

Local Mega Saver context daemon (intent excerpts + memory).

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `serve` | `mega daemon serve [--store <dir>]` | Run the local Mega Saver context daemon (machine-wide singleton). |

---

## `mega proxy`

Local Anthropic-API proxy for token metering (opt-in).

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `start` | `mega proxy start [--port <n>] [--upstream <url>]` | Start the local proxy. Default port: 8787. Default upstream: `https://api.anthropic.com`. |

Point your agent at the proxy:

```sh
mega proxy start
export ANTHROPIC_BASE_URL=http://localhost:8787
```

Only token/model counts are recorded — never prompts, responses, or keys.

---

## `mega memory`

Manage Mega Saver memory entries.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `create` | `mega memory create <project> --scope <scope> --content <text> [--type <type>] [--session <id>] [--confidence <level>] [--source <source>] [--title <text>] [--keyword <kw>] [--file <path>] [--expires <ISO-8601>]` | Create a memory entry. |
| `list` | `mega memory list <project>` | List memory entries for a project. |
| `search` | `mega memory search <project> [<query>] [--type <type>] [--confidence <level>] [--scope <scope>] [--limit <n>] [--include-stale] [--include-unapproved]` | Search memory entries. |
| `show` | `mega memory show <id>` | Show a memory entry. |
| `update` | `mega memory update <id> [fields...]` | Update a memory entry. |
| `delete` | `mega memory delete <id>` | Delete a memory entry. |
| `approve` | `mega memory approve <id>` | Approve a suggested memory entry. |
| `explain` | `mega memory explain <id>` | Explain why a memory entry exists. |
| `graph` | `mega memory graph <project>` | Show the memory graph for a project. |
| `read-wiki` | `mega memory read-wiki <project>` | Read the project wiki from memory. |
| `review` | `mega memory review <project>` | Review pending memory entries. |

`--scope`: `project | session`. `--type`: `decision | bug | architecture | todo | user_preference | failed_attempt | code_pattern | project_rule | dependency | test_behavior`. `--confidence`: `low | medium | high`. `--source`: `manual | agent | test_failure | git_diff | session_summary`.

**Examples:**

```sh
mega memory create my-app --scope project --content "Use Zod for all external boundaries" --type architecture
mega memory search my-app "auth" --type decision
mega memory approve <memory-id>
```

---

## `mega index`

Build and query the semantic code index.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `build` | `mega index build <project>` | Build/refresh the semantic index for a project. |
| `search` | `mega index search <project> <query> [--type <block-type>] [--limit <n>]` | Search the semantic index by query. |
| `status` | `mega index status <project>` | Show index build status. |
| `show` | `mega index show <project>` | Show index details. |

**Examples:**

```sh
mega index build my-app
mega index search my-app "authentication middleware" --limit 5
```

---

## `mega scan`

Scan a project's repo for indexable files.

```sh
mega scan <project>
```

---

## `mega learn`

Learn reusable rules from failures.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `from-failure` | `mega learn from-failure <failed-attempt-id> --title <text> --rule <text> --severity <level> [--confidence <level>] [--applies-to <path>]` | Convert a failed attempt into a project rule. |

`--severity`: `info | warning | critical`. `--confidence`: `low | medium | high`.

**Examples:**

```sh
mega learn from-failure <id> --title "Never use parseInt without radix" --rule "Always pass radix to parseInt" --severity warning
```

---

## `mega doctor`

Environment diagnostics. Checks Node version, platform, cwd, and Claude Code
hook telemetry installation.

```sh
mega doctor
```

---

## Global flags

These flags are available on all commands:

| Flag | Description |
|------|-------------|
| `--store <dir>` | Override the default store directory. |
| `--json` | Emit JSON output instead of human-readable text. |

The store defaults to `~/.local/share/megasaver` on Linux/macOS (XDG) and
`%LOCALAPPDATA%\megasaver` on Windows.
