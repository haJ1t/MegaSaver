---
feature: mcp-security-doctor
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer, security-reviewer]
build-order: "12 of 20 (wave-2 batch)"
---

# MCP Security Doctor (`mega mcp doctor`) — Design Spec

## Problem

Users wire MCP servers into four agents through config files nothing audits.
The 2026 research scan (wiki/syntheses/llm-code-problems-research-2026-07.md,
proposal 10) documents the risk classes: generic scanners catch only 23% of
MCP-specific vulns, and 41% of 5000+ public MCP tools are clones of another
tool — the confused-deputy setup where an agent calls the wrong server's
`read_file`. Add description-embedded prompt injection ("ignore previous…",
url-bearing imperatives) and a config surface where a world-writable
`mcp.json` equals arbitrary tool injection, and there is no local tool that
tells an operator which of these apply to *their* machine.

## Goal

`mega mcp doctor`: a **read-only, local, static** audit of the configured MCP
surface across the four known agents. Output: a severity table with
per-finding remediation text, `--json` for the same report as one JSON line,
exit code 1 iff any `critical`/`high` finding. Four checks: over-privilege,
tool-name clones/shadowing, description hygiene, config surface.

## Non-Goals (YAGNI)

- **No server spawning / `tools/list` handshake.** Executing every configured
  server binary is itself the supply-chain attack we audit. Opt-in handshake
  is v2.
- No config mutation, auto-fix, or `--fix` flag. Read-only in v1.
- No network calls (no registry lookups, no clone DB).
- No auditing of agent-native config surfaces mega does not manage (e.g.
  Claude Code project `.mcp.json`); v1 reads the four `detectAgent` paths.
- No third-party description retrieval — hygiene runs on descriptions we
  actually possess (our bridge's `TOOL_DEFS`; injected evidence later).
- No new i18n; English strings (§11).

## Evidence model (the honesty contract)

Verified observable, and nothing else:

1. **Agent configs** — `detectAgent` paths
   (`packages/mcp-bridge/src/setup/detect-agent.ts`): `~/.config/claude/mcp.json`,
   `~/.cursor/mcp.json`, `~/.codex/mcp.json`, `~/.aider/mcp.json`; entries
   `{command, args?}` written by us, possibly `url`/`env` written by others.
2. **Our bridge, statically** — `TOOL_DEFS` (35 ids + descriptions,
   `packages/mcp-bridge/src/server.ts:136`) and both naming modes
   (`tool-naming.ts`: proxy default, legacy opt-out).
3. **Hook log** — `<cwd>/.megasaver/hooks/claude-tool-calls.jsonl`
   (`apps/cli/src/hooks/logger.ts`): PreToolUse metadata lines. Any
   `mcp__<server>__<tool>` call IS logged (category `eligible_mcp`) — wire
   name + timestamp only, never arguments. Two verified blind spots:
   `mcp__megasaver__*` is self-log-excluded (logger.ts:31), and
   `stats.ingestHookLog` counts only the five native tools, so the doctor
   needs its own MCP-line parser.

**Everything else is unobservable and MUST be reported as `unknown`, never
guessed**: third-party tool inventories and descriptions (no handshake), our
own bridge's usage (self-log exclusion), call arguments (metadata-only hook
contract), usage on agents other than Claude Code (no hook exists).

## Locked Decisions

1. **Read-only.** The doctor performs zero filesystem writes.
2. **Static-only.** Never execute a configured server command (Non-Goal 1).
3. **Engine lives in `packages/mcp-bridge/src/doctor/`.** The bridge already
   owns agent config knowledge (`setup/`), tool naming, and `TOOL_DEFS`. The
   CLI command is a thin wrapper (status.ts pattern). No agent-specific logic
   enters `@megasaver/core` (§1).
4. **Hook-log content is injected** into the engine as `string | null`; the
   CLI reads `join(cwd, HOOK_LOG_RELATIVE_PATH)`. No `@megasaver/stats` edit;
   no new package deps (and no pnpm catalog exists — plain specifiers only).
5. **No regex in any analyzer.** Hygiene probes are lowercase literal
   substrings via `includes`; tokenization is a hand-rolled linear loop;
   near-duplicate naming uses an O(n) two-pointer edit-distance-≤1 check, not
   DP; URL checks use `new URL`. A cost-ceiling guard test fences the scanner
   (wiki/concepts/redos-guard-testing) and non-vacuity is asserted
   structurally, not by throughput.
6. **Enum order contract**: every new `z.enum` is alphabetic (AA1 §8, §17)
   with a tripwire test; display ordering uses an explicit `SEVERITY_RANK`
   map, never schema order.
7. **Shadowing is checked against BOTH naming modes** — the union of
   `exposedToolName(id, "proxy" | "legacy")` over all 35 ids — because the
   effective `MEGASAVER_TOOL_NAMING` can differ per agent process.
8. **Findings never echo secrets**: no `env` values, no full `args`; URLs are
   reduced to origin, env vars to key names.
9. **Exit code 1 iff any `critical` or `high` finding**; warnings don't gate.

## Architecture

```
apps/cli/src/commands/mcp/doctor.ts        runMcpDoctor (table/--json/exit)
        │  home = resolveHomeDir()  (HOME ?? USERPROFILE, store.ts:45)
        │  hookLogContent = read(join(cwd, HOOK_LOG_RELATIVE_PATH)) | null
        ▼
packages/mcp-bridge/src/doctor/
  report.ts          severity/check/code enums + Finding + Report schemas
  config-surface.ts  passthrough config read, perms stat, URL scan     (d)
  hook-evidence.ts   JSONL → per-server observed tool-call counts      (a)
  capability.ts      write/exec/network lexicon over tool names/descs  (a)
  clones.ts          exact/near dup + bridge-shadow detection          (b)
  hygiene.ts         literal injection probes over descriptions        (c)
  run.ts             auditMcpSecurity(input): McpSecurityReport
```

## Components & checks

### Check `config_surface` (d)

Per agent: report `configPath`, presence, and server keys (raw passthrough
Zod read — our installer's `readConfig` strips unknown fields, so the doctor
has its own schema). Findings: world-writable config (`mode & 0o002`) →
`critical`; group-writable → `medium`; malformed JSON → `medium`
(`config_unreadable`); `url` field, or an http(s) token inside `args`/`env`
values, whose hostname is not loopback (`localhost`, `127.*`, `::1`,
`*.localhost`, `0.0.0.0` — as a connect address `0.0.0.0` reaches the
local host on mainstream OSes, so flagging it would be a false
positive) → `medium` (`non_localhost_url`, origin only). On win32 the
permission bits are synthetic → `info` `evidence_gap` ("unknown"), matching
`resolveHomeDir`'s Windows posture.

### Check `over_privilege` (a)

Capability lexicon (write/exec/network token sets) over bare tool names, plus
descriptions where possessed. Cross-referenced against hook-log usage:
- Third-party server observed in the log → per-tool capability findings
  (`low`) with call counts. Observed tools are by definition used; the
  *full* inventory is unobservable → over-privilege verdict `unknown`.
- Configured server never observed → inventory AND usage `unknown` (`info`
  `evidence_gap`, remediation: v2 handshake / manual `tools/list`).
- Our bridge: full static inventory, usage `unknown` by design (self-log
  exclusion) — stated, not guessed.
- No hook log at all → `usageEvidence: "none"`, one `info` finding with
  remediation `mega hooks install` (mirrors stats' honest-metrics rule:
  interception claims only when a hook log exists).

### Check `clone_shadowing` (b)

Name pool = observed third-party bare names (per server) + our exposed names
(both modes). Exact same bare name on ≥2 distinct servers → `high`
(`clone_exact`). Third-party name equal (raw or normalized) to a
bridge-exposed name → `high` (`shadows_bridge_tool`). Normalization collision
(lowercase, strip `-_`) or edit distance ≤ 1 across servers → `medium`
(`clone_near`). Pairwise pass capped at 500 distinct names → `info`
`inventory_truncated` beyond.

### Check `description_hygiene` (c)

Literal probes: "ignore previous", "disregard the above", "always call",
"must call this tool", "before using any other tool", "do not tell the
user", "instead of using", …; plus url-instruction = `http(s)://` marker AND
an imperative token (call/visit/fetch/send/post/open) → `high` per hit. Runs
on our own `TOOL_DEFS` today (dogfood; a test pins zero self-findings) and on
any injected third-party descriptions later.

### Report & CLI

`McpSecurityFinding`: `{checkId, code, severity, agentId?, serverKey?,
toolName?, message, remediation}`. Report: `{generatedAt, agents[],
findings[], usageEvidence}`, deterministically sorted (rank, code, agent,
server, tool); injectable `now`. Human output: fixed-column table + a
`Remediation:` line per finding + summary count line. `--json`: one line.

## Error handling

The engine never throws: missing config → `present: false`; malformed
JSON/stat failure → finding or `unknown`, keep going; hook-log lines that
fail `JSON.parse` are skipped (logger discipline). Boundary validation via
Zod at the two inputs (config files, hook lines); internals trusted (§8).

## Security & privacy

Reads only local config metadata + hook metadata (the logger never records
command bodies or file contents). Locked Decision 8 keeps tokens in `args`/
`env` out of the report. No network. Doctor output itself is safe to paste
into an issue.

## Testing

- Analyzer units with realistic fixtures (temp `mcp.json` homes, JSONL hook
  lines matching logger.ts shape); `chmod` tests `skipIf` win32.
- CLI via wiki/workflows/cli-test-pattern: injected `home`/`cwd`/`stdout`;
  temp-dir fixtures; `--json` parsed and asserted.
- Guard test: 100 KB adversarial description corpus under a loose 5 s
  ceiling (mirrors output-filter/test/classify-redos.test.ts; no
  timing-tight assertions) + structural non-vacuity (planted probe is hit;
  probe list is literal-only).
- Enum-order tripwires: options equal their sorted copy.

## Risk & process

MEDIUM: read-only diagnostics, no core seams, no mutation. Chain per §4 in
worktree `feat/mcp-security-doctor`; reviewers `code-reviewer` +
`security-reviewer` (frontmatter). **Escalation to HIGH** if implementation
ever mutates a config, spawns a configured server, or edits policy/core.

## Dependencies / build order

12 of 20 in the wave-2 batch; independent of the other nineteen. Touches
`@megasaver/mcp-bridge` (new `doctor/` module + `TOOL_DEFS` export) and
`@megasaver/cli` (new subcommand). Changeset required (DoD #9). Wiki
`entities/cli` + `entities/mcp-bridge` updates on completion (DoD #10 n/a —
no convention change).

## Open questions

1. Should `clone_exact` between two *third-party* servers outrank
   `shadows_bridge_tool`? (v1: both `high`.)
2. Audit agent-native project-scoped MCP files (Claude Code `.mcp.json`) —
   v2 scope with per-agent adapters?
3. v2 handshake: sandboxed `tools/list` probe design + consent gate.
