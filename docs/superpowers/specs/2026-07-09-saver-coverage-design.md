---
title: Saver Coverage Wave 1 (A1-A7 + minimal escape hatch) — design
status: approved-pending-user-review
risk: HIGH
created: 2026-07-09
sources:
  - wiki/syntheses/saver-savings-gaps.md (findings A1-A7, C11, C13)
  - grounding workflow wf_55dd4048-e87 (4 scouts, 2026-07-09)
---

# Saver Coverage Wave 1 — design

## TL;DR

The PostToolUse saver hook today compresses only 6 native tools; the
highest-volume outputs (Task reports, background-shell retrievals, all
`mcp__*` tools, WebSearch/ToolSearch, Grep/Glob filename arrays, Bash
stderr) enter context raw (gap findings A1-A7). Wave 1 extends coverage
to all of them AND makes every compression genuinely recoverable in-session
via the already-existing `mega output chunk` CLI (findings C11/C13: the
advertised `proxy_expand_chunk` recovery path is dead end-to-end —
live-verified). 2.0 scope, first of five gap-fix waves.

## Locked decisions (user, 2026-07-09)

1. **Coverage-first with a minimal escape hatch** — new surfaces are only
   compressed because recovery becomes real in the same wave.
2. **No new `OutputSourceKind` member.** On the hook path the kind only
   drives persistence labels + stats buckets (`filterOutput` never receives
   `source` there — record-output.ts:95-100). Adding a member costs 9 files
   + the 8-enum-pin audit. New tools map onto the existing 4 kinds. Stats
   bucket semantics drift slightly (Task counted under `proxy_run_command`);
   accepted, Wave 5 (metrics honesty) fixes attribution.
3. **Conservative floor for new surfaces**: newly covered tools gate at
   `max(modeToBudget(mode), 16384)` bytes (`NEW_SURFACE_MIN_BYTES = 16384`).
   Existing 6 tools keep today's thresholds — no regression either way.

## A. Coverage extension (`apps/cli/src/hooks/saver.ts`)

`TOOL_SOURCE` and matcher grow; kind mapping (grounded against label
validity — the `fetch` chunk-set source Zod-requires a valid URL, so any
tool whose label is not a URL must NOT map to `fetch`):

| Tool | Kind | Label (via `labelOf`) |
|---|---|---|
| `Task` | `command` | `description` → add to labelOf; fallback tool name |
| `BashOutput` / `Monitor` | `command` | fallback tool name |
| `WebSearch` | `grep` | `query` → add to labelOf |
| `ToolSearch` | `grep` | `query` |
| `mcp__*` (dynamic) | `command` | fallback tool name |

- `mcp__*` resolution is a code branch (prefix match), not a map entry.
  **Exclusion:** tool names matching `/^mcp__megasaver__/i` (Mega Saver's own
  bridge) pass through — their outputs are already compressed.
- `labelOf` gains `description` and `query` lookups (after `pattern`,
  before `url`).
- PreToolUse telemetry (`logger.ts TOOL_CATEGORY` + `HOOK_MATCHER`) grows in
  lockstep: `Task`/`BashOutput` → `eligible_command`, `WebSearch`/`ToolSearch`
  → `eligible_search`, `mcp__*` → `eligible_mcp` (new category string; the
  category map stays `Record<string, string>` — no schema change).

## B. New shapes in `readOutputShape`

1. **Filename arrays (A5, Grep `files_with_matches` + Glob):**
   `{ filenames: string[] }` with ≥1 entry → `raw = filenames.join("\n")`,
   `rebuild: (t) => ({ ...o, filenames: t.split("\n") })`. Schema preserved
   (stays `string[]`); a compressed result is fewer, ranked paths + the
   footer. This consciously reverses the original "Glob is high-signal,
   never compressed" test — the gap audit measured 30KB+ uncapped leaks.
2. **Bash stderr (A6):** when `stdout`/`stderr` are both strings, the
   compressible slot is the LARGER stream; the other stream is untouched
   (schema + stdout/stderr distinction preserved). Covers the pnpm/cargo
   bulk-on-stderr case with no new machinery. The size gate measures the
   chosen slot.
3. **Mixed content arrays (A7):** arrays with ≥1 text block and ≥1 non-text
   block: join text blocks → compress → rebuild places one compressed text
   block at the first text block's position, non-text blocks keep their
   positions verbatim. (Pure-text arrays keep today's behavior; zero-text
   arrays remain passthrough.)

## C. Escape hatch (C11 + C13)

1. **Footer** points at the working Bash-callable path first:
   `run: mega output chunk "<chunkSetId>" "0"` (keeps a trailing mention of
   `proxy_expand_chunk` for bridge-connected sessions). PARTIAL-truncation
   variant keeps its warning.
2. **Overlay read support in `fetchChunk`** (packages/context-gate) — the
   root-cause spot: CLI `mega output chunk`, daemon `/expand-registry`, and
   the mcp-bridge fallback ALL route through it, so one fix repairs every
   consumer. Live-verified failure chain today: `locateChunkSet` matches the
   overlay file, then `validateIds` rejects the 16-hex `workspaceKey` as a
   ProjectId → `store_corrupt: Invalid id.`. Fix: `locateChunkSet` tags the
   located pair by dir shape (`/^[0-9a-f]{16}$/` ⇒ overlay) and `fetchChunk`
   loads via `loadOverlayChunkSet` for that shape. Both primitives exist;
   no storage change. Also harden the `content/` scan against stray
   non-directory entries (`.DS_Store` — gap C15, one `statSync` guard).
3. **No re-compression of expansions (C13):** in `buildSaverDecision`, a
   Bash `tool_input.command` matching `/\bmega\s+output\s+chunk\b/` returns
   PASSTHROUGH before the record call — expansion output must arrive whole.

## D. Matcher upgrade path

`SAVER_HOOK_MATCHER` becomes
`Read|Bash|Grep|Glob|LS|WebFetch|Task|BashOutput|WebSearch|ToolSearch|mcp__.*`
(Claude Code matchers are regex; repo precedent uses alternation).
`HOOK_MATCHER` (PreToolUse telemetry) grows to the same tool list.
**Existing installs won't auto-update** — the presence check is
command-keyed (`entryReferencesCommand`), so `installClaudeCodeHook` gains
matcher-drift repair: when the entry for our command exists with a stale
matcher, rewrite the matcher in place (still `changed: true`, atomic write
preserved). `mega hooks install` re-run = upgrade.

## E. Error handling / edge cases

- Unknown/new tool_response shapes still return null → passthrough (never
  guess a shape).
- A record() throw keeps today's fail-open catch (whole-wave telemetry is
  Wave 4 scope), hook always exits 0.
- Filename-array rebuild of an empty compressed text → `[""]` guard: skip
  compression if the filtered result would be empty (record decision
  already guarantees non-empty `returnedText`; assert in test).
- `mcp__mega*` exclusion tested (no self-compression loops).

## F. Testing (TDD, red first)

Unit (`apps/cli/test/hooks/saver.test.ts` + hook-settings/install tests):
- Each new tool: >floor payload → compressed with footer, <floor →
  passthrough (floor = max(modeBudget, 16384) — boundary test at 16384).
- `mcp__somevendor__get_page` compressed; `mcp__megasaver__anything`
  passthrough.
- Grep files-mode/Glob: 2000-filename fixture → compressed, rebuild yields
  `filenames: string[]`; existing Glob passthrough test REWRITTEN (design
  reversal, cite this spec).
- Bash: bulk-on-stderr fixture → stderr slot compressed, stdout untouched;
  bulk-on-stdout unchanged behavior.
- Mixed content array: text+image fixture → text compressed, image block
  byte-identical, positions held.
- Footer: contains `mega output chunk "<id>" "0"`.
- `mega output chunk` Bash command in tool_input → passthrough (C13).
- Matcher-drift repair: settings with old 6-tool matcher + our command →
  install rewrites matcher, `changed: true`; foreign entries untouched.
- context-gate: `fetchChunk` reads an overlay-layout set (tmpdir fixture
  written via `saveOverlayChunkSet`) → `{ ok: true, chunk }`; registry sets
  keep working; `.DS_Store` in `content/` doesn't break the scan.
Integration: hook-compressed output (real `recordAndFilterOverlayOutput`)
→ `mega output chunk <set> 0` returns the full raw (the C11 repro, now
green). Smoke evidence: live repro of this session's failing chunk fetch
succeeding on the fixed build.

## Review sign-offs (2026-07-09, both APPROVE-WITH-NITS)

- **Live-shape follow-up (critic):** wave-1 tests use synthetic `tool_response`
  shapes. `mcp__*` (MCP content-block standard) and Bash-like shapes are
  confirmed matched; the REAL WebSearch/ToolSearch/Task runtime shapes are
  unverified against a live capture — if one is a structured object with no
  recognized text slot, that surface silently stays passthrough (safe: no
  corruption, just no compression). A live smoke capturing real payloads is
  the follow-up before claiming those surfaces are actually compressed.
- **Daemon surface (critic F4, consciously accepted):** `fetchChunk` becoming
  overlay-aware broadens the ungated daemon `/expand-registry` path from
  registry-only to overlay chunk sets. Not exploitable (chunkSetIds are random
  UUIDv4; the local user already has fs access to the store; the MCP-bridge
  per-response `allowedChunkSetIds` guard is layout-agnostic and still gates
  that path). Accepted as an extension of a pre-existing architectural property.

## Non-goals (later waves)

Combined stdout+stderr gating + both-slot compression (wave 1 gates on and
compresses only the larger stream — a review-found leak when both streams are
comparably large and each below floor; documented in code);
per-chunk (non-all-or-nothing) recovery model, GC/retention (Wave 2);
elision markers, intent scope/tokenizer, dead band, source→AST plumbing
(Wave 3); fail-open telemetry, doctor-verifies-fire, PATH-absolute hooks
(Wave 4); stats attribution for new kinds, footer bytes in savings math
(Wave 5).

## Risk & process

HIGH (§12: saver core touches every tool output). Isolated worktree
(`feat/saver-coverage`), TDD, code-reviewer AND critic in separate fresh
contexts. Changeset: `@megasaver/cli` minor, `@megasaver/context-gate`
patch, `@megasaver/connector-claude-code` patch (ships in 2.0 train).
