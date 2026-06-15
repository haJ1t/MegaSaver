---
title: Realized Saver Mode via Claude Code PostToolUse hook
date: 2026-06-15
status: draft
risk: HIGH
risk_note: >
  The hook alters what the agent ingests (it replaces native tool output with a
  compressed version via PostToolUse `updatedToolOutput`). Evidence-preserving
  compression is a §12 HIGH concern. Mitigated by: never blocking (exit 0; any
  error ⇒ original output untouched), storing the full raw output as a
  recoverable chunk, redacting secrets, and gating on the per-workspace Saver
  Mode toggle + a size budget.
branch: feat/cli-saver-posttooluse-hook
---

# Realized Saver Mode via Claude Code PostToolUse hook

## 1. Problem

The GUI "Token saver" tab reads **overlay** token-saver stats
(`<storeRoot>/stats/<workspaceKey>/<liveSessionId>.{json,events.jsonl}`). The
read path + the live tab (#138) are built, and the overlay **write** primitives
(`runOverlayOutputPipeline`, `appendOverlayEvent`) exist and are unit-tested —
but **no runtime producer calls them**. The only runtime that compresses
(`@megasaver/mcp-bridge` proxy tools) writes **registry-keyed** stats (the
pre-live-first path the GUI no longer reads), and it cannot key by
`liveSessionId` because the MCP protocol gives it no Claude session id per call.

Consequence: the live tab always shows "No proxy activity," and Saver Mode
(activation) renders the CONTEXT_GATE block but realizes **no** token savings on
native tool calls.

### Key enabler

A Claude Code **PostToolUse** hook (confirmed against the CC hook docs):
- receives `tool_name`, `tool_input`, `tool_output.content[].text`,
  `session_id`, and `cwd` on stdin;
- runs **after execution but before the model ingests the result**, and may
  return `hookSpecificOutput.updatedToolOutput` to **replace** what the model
  sees;
- supports a tool-name matcher (`Read|Bash|Grep|Glob|LS`);
- exit 0 ⇒ normal flow; a non-blocking failure leaves the original result
  untouched.

So a PostToolUse hook is the one runtime point that has **both** the Claude
`liveSessionId` (`session_id`) **and** the tool output — exactly what the
overlay write path needs, and it can realize the saving.

## 2. Goal

Realize token savings on native tool output for workspaces with Saver Mode
enabled, and record the per-session overlay events that populate the live tab.

### Non-goals

- Changing the MCP proxy-tool path (`@megasaver/mcp-bridge`) or its
  registry-keyed stats.
- Compressing `Write`/`Edit` or MCP tool outputs (only the five read/observe
  tools).
- Any GUI change (#138 already reads these overlay events).
- Re-running commands (the hook compresses the *already-produced* output; it
  never re-executes anything).

## 3. Architecture — runtime flow

Per eligible native tool call, when Saver Mode is enabled for the workspace:

```
Claude runs Read|Bash|Grep|Glob|LS
  → PostToolUse → `mega hooks saver`  (stdin: tool_name, tool_output, session_id, cwd)
  → gates: eligible tool? + Saver Mode enabled for encode(cwd)? + raw > mode budget?
  → recordAndFilterOverlayOutput(raw, mode)         [filterOutput: rank → fit → summary,
        store raw chunk, redact secrets]
  → appendOverlayEvent(wk=encode(cwd), liveSessionId=session_id, raw/returned/saved)
  → stdout: { hookSpecificOutput: { updatedToolOutput: <compressed + "expand chunk <id>"> } }
  → model ingests the compressed result                       ← REALIZED saving
  (disabled | small | any error → emit nothing → original output, exit 0)
```

`workspaceKey = encodeWorkspaceKey(cwd)` and `liveSessionId = session_id` match
exactly what the GUI live tab reads → the tab populates live.

## 4. Components

### 4.1 `@megasaver/context-gate` — new primitive `recordAndFilterOverlayOutput`

Generalizes the file-only `runOverlayOutputPipeline` to an **existing output
buffer** (Bash/Grep/etc. produce stdout, not a file path).

Input: `{ storeRoot, workspaceKey, liveSessionId, cwd, raw: string, sourceKind,
label, mode, maxReturnedBytes?, storeRawOutput }`.
Behavior: `filterOutput({ raw, mode, maxReturnedBytes })` → if `storeRawOutput`,
`persistOverlayChunkSet` → `appendOverlayEvent({ workspaceKey, liveSessionId,
rawBytes/returnedBytes/bytesSaved/savingRatio, sourceKind, label, chunkSetId,
mode })`. Returns `{ returnedText, summary, chunkSetId?, savings }`.
No re-execution, no path gating (the output is already produced and trusted as
the tool's own result).

### 4.2 `@megasaver/cli` — `mega hooks saver` (+ stdin wrapper)

Mirrors the existing `mega hooks log` / `logger-run.ts` split:
- `hooks/saver.ts` — pure: `buildSaverDecision(payload, deps)` → either
  `{ passthrough: true }` or `{ updatedToolOutput: string }`, given the parsed
  PostToolUse payload + a store/settings reader + the filter primitive.
- `hooks/saver-run.ts` — reads stdin, resolves store root, invokes the pure fn,
  writes the `hookSpecificOutput` JSON to stdout, **always exits 0**.
- `commands/hooks/saver.ts` — the citty command wiring (`mega hooks saver`).

Gates (in order, any miss ⇒ passthrough):
1. `tool_name ∈ {Read,Bash,Grep,Glob,LS}`.
2. Saver Mode enabled: read `<storeRoot>/stats/<wk>/workspace-token-saver.json`;
   `enabled === true` (reuse the same file the activation route writes). Absent
   / malformed ⇒ disabled.
3. `raw` length > `modeToBudget(mode)` (small outputs pass through untouched).

On success: emit `updatedToolOutput`. On ANY error (bad payload, store write
failure, filter error): emit nothing, exit 0 → the model keeps the original
output. Never throws, never blocks.

### 4.3 `@megasaver/cli` — installer extension

Extend `mega hooks install` to also add a **PostToolUse** entry
(`matcher: "Read|Bash|Grep|Glob|LS"`, command `mega hooks saver`) alongside the
existing PreToolUse telemetry entry. Idempotent (re-running is a no-op). The
pure merge helpers mirror `addPreToolUseHook`.

### 4.4 GUI — none

#138 already reads these overlay events. No change.

## 5. Safety (HIGH — the hook alters agent input)

- **Never blocks, never loses data:** exit 0 always; any error ⇒ no
  `updatedToolOutput` ⇒ model gets the original, unmodified output. Extends the
  metadata logger's §13.4 best-effort stance to the content-processing case.
- **Evidence-preserving:** `filterOutput` ranks + fits + summarizes (keeps
  errors, head/tail, structure); the **full raw** output is stored as a chunk
  (`storeRawOutput`), and the returned text states how to recover it
  (`mega_fetch_chunk` / `proxy_expand_chunk <chunkSetId>`). Never a hard
  truncation that loses evidence irrecoverably.
- **Secret redaction:** `filterOutput`'s redaction runs before the compressed
  text is returned **and** before the raw chunk is stored; the event records
  `secretsRedacted`.
- **Opt-in + gated:** only active when the user installed the hook AND turned
  Saver Mode on for that workspace AND the output exceeds the mode budget.
- **No-intent caveat:** native interception carries no `intent` (proxy tools
  do), so ranking is generic; acceptable because raw is always recoverable.

## 6. Compression policy

Use the workspace's Saver Mode `mode` (from `workspace-token-saver.json`) and
its budget via `modeToBudget` (aggressive 4 KB / balanced 12 KB / safe 32 KB).
Compress only when `raw` exceeds the budget; otherwise pass through. (Chosen
over a fixed conservative floor so the hook honors the mode the user picked in
the toggle.)

## 7. Testing (TDD)

- **context-gate primitive:** filters a buffer; writes an overlay event keyed by
  (wk, liveSessionId); persists a recoverable raw chunk; redacts secrets;
  reports raw/returned/saved bytes.
- **hook pure fn (`buildSaverDecision`):** disabled ⇒ passthrough; ineligible
  tool ⇒ passthrough; small output ⇒ passthrough; eligible+enabled+large ⇒
  `updatedToolOutput` returned AND overlay event written; malformed payload ⇒
  passthrough (no throw).
- **saver-run wrapper:** bad stdin ⇒ exit 0, no output; success ⇒ emits the
  `hookSpecificOutput` JSON shape Claude Code expects.
- **installer:** adds the PostToolUse entry; idempotent; preserves the existing
  PreToolUse entry + unrelated keys.
- **evidence:** after a compress, the stored chunk round-trips the full raw.
- Plus `pnpm verify` green and a manual smoke: pipe a synthetic PostToolUse
  payload (large Bash output, Saver Mode on) into `mega hooks saver` →
  assert an overlay event file appears under `stats/<wk>/` and stdout carries
  `updatedToolOutput`; then open the GUI Token saver tab → rows appear/refresh.

## 8. Risk & process

- Risk HIGH (evidence-preserving compression that alters agent input).
- Per §12: full superpowers chain + architect design review + critic
  adversarial review + worktree (already on `feat/cli-saver-posttooluse-hook`).
- Changeset (`@megasaver/cli`, `@megasaver/context-gate`).
- Wiki: update `entities/cli`, `entities/context-gate`, `concepts/proxy-mode`
  (or a new note), append `log.md`.

## 9. Open questions (resolved at plan time)

- Exact `filterOutput` input/return shape for an arbitrary buffer (vs the
  file-read `readAndFilter`) — confirm the public `filterOutput` signature and
  `sourceKind`/`OutputSourceKind` values.
- Whether `mega hooks install` should gain a flag to install only the telemetry
  (PreToolUse) hook vs both — default: install both; revisit if needed.
- Exact `updatedToolOutput` JSON shape Claude Code expects (string vs the
  `{content:[...]}` object) — confirm against the hook docs during Task 2.
