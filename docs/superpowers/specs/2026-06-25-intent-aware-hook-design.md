---
feature: intent-aware-hook
phase: 6b
date: 2026-06-25
risk: MEDIUM
status: approved-design
reviewers: [code-reviewer]
build-order: "1 of 3 (#2 -> #1 -> #3)"
---

# Intent-Aware Hook (Phase 6b)

## Problem

Native tool output captured by the PostToolUse saver hook (`Read`,
`Bash`, `WebFetch`, etc.) is compressed and ranked **without an
intent**. `buildSaverDecision` calls `record(...)` with `workspaceKey`,
`liveSessionId`, `raw`, `sourceKind`, `label`, `mode`,
`storeRawOutput` — but never `intent`. So `filterOutput` →
`scoreChunk` ranks with an empty intent (generic keyword scoring).

Proxy tools (`proxy_read_file`, `proxy_run_command`,
`proxy_search_code`) already carry an explicit, validated `intent`, so
only the **hook path** is generic. This is the known Phase 6 gap.

## Goal

Capture the user's latest prompt and use it as the ranking intent for
the hook path, **only when no explicit intent is present** (fill-gap).
Result: native captured output ranks by the user's current task
instead of generically.

## Non-Goals (YAGNI)

- Per-tool-call intent history (latest-prompt-wins only).
- A daemon HTTP route for intent (file transport only).
- TTL / staleness expiry (every new prompt overwrites; between
  prompts all tool calls belong to that prompt's turn).
- Merge mode (session intent + tool intent combined).
- Changing `scoreChunk` / keyword weights. Intent is an **input**;
  the ranking algorithm is untouched. (If weights change, risk
  escalates to HIGH.)

## Locked Decisions

1. **Precedence: fill-gap.** `sessionIntent` is used only when the
   consumer has no explicit `intent`. Tool-explicit intent always
   wins. This keeps the change MEDIUM and targets exactly the generic
   gap.
2. **Transport: workspace-keyed file in storeRoot.** The
   `UserPromptSubmit` hook writes the latest prompt to
   `<storeRoot>/stats/<workspaceKey>/session-intent.json`. Both the
   daemon path and the in-process path read it. No new daemon route.
   Latest-prompt-wins (overwrite).

## Components

### 1. Capture hook (new) — `UserPromptSubmit`

New CLI hook handler (sibling to `saver-run.ts`). Reads the
`UserPromptSubmit` payload from stdin (`{ prompt, session_id, cwd, ...
}`), derives `workspaceKey`, writes
`<storeRoot>/stats/<workspaceKey>/session-intent.json` as
`{ prompt, ts }`.

- Atomic write: write to `<file>.tmp` then `rename`.
- Latest-wins: overwrite on every prompt.
- Always exits 0, best-effort. Any failure → write nothing, never
  block the prompt. (Mirrors `runSaverHookFromProcess` discipline.)
- Empty/whitespace prompt → write nothing.

### 2. Shared `workspaceKey` derivation (the one correctness risk)

The capture hook and `buildSaverDecision` **must** derive an identical
`workspaceKey`, or the reader silently never hits the file written by
the writer.

Already solved by reuse: `buildSaverDecision` uses
`workspaceKey = encodeWorkspaceKey(cwd)`, and `encodeWorkspaceKey` is
an exported helper in `@megasaver/shared`
(`packages/shared/src/workspace-key.ts`). The capture hook calls the
**same** `encodeWorkspaceKey(cwd)`. The `UserPromptSubmit` payload
includes `cwd`, so parity is automatic — no extraction, no second
derivation path.

### 3. Reader helper — `readSessionIntent`

`readSessionIntent(storeRoot, workspaceKey): string | undefined`.
Mirrors the existing `readSettings` pattern in `saver-run.ts`:

- `existsSync` guard.
- Zod `safeParse` on `{ prompt: string, ts: number }`.
- `catch` → `undefined`.
- Empty `prompt` → `undefined`.

### 4. Fill-gap injection — `buildSaverDecision`

In `apps/cli/src/hooks/saver.ts`, before the `record(...)` call: if no
`intent` is set (always true on the hook path today), set
`intent: readSessionIntent(storeRoot, workspaceKey)`. When the reader
returns `undefined`, behavior is exactly today's (generic).

### 5. Daemon schema passthrough

Once `intent` is on the `record` input, it flows into the daemon
`/excerpt` request body (`saver-run.ts` `makeRecord` spreads the input
minus `storeRoot`/`evidenceStoreRoot`/`now`/`newId`). The daemon
`/excerpt` Zod request schema must accept `intent`; if it is
`.strict()` and omits the field, add it, or intent is silently dropped
on the daemon path while the in-process fallback still carries it.
Verify and add if missing.

### 6. Install

Add the `UserPromptSubmit` entry to the mega-managed hook block in
`apps/cli/src/commands/hooks/install.ts`, using the same managed
mechanism as the PostToolUse saver hook.

## Data Flow

```
UserPromptSubmit
  -> capture hook derives workspaceKey
  -> writes <storeRoot>/stats/<wk>/session-intent.json {prompt, ts}

(later, same turn) native tool runs
  -> PostToolUse -> saver-run -> buildSaverDecision
       intent absent -> readSessionIntent(storeRoot, wk)
  -> record({ ..., intent })
       -> daemon POST /excerpt (intent in body)  OR  in-process fallback
  -> filterOutput({ raw, intent, ... })
  -> scoreChunk(intent, chunk) keyword ranking
```

## Error Handling / Boundaries

- File missing / unreadable / malformed JSON / empty prompt →
  `undefined` → today's generic behavior. No crash. (§13.4
  best-effort: never break the tool call.)
- Zod validation at the file-read boundary.
- All paths via `node:path` `join` (cross-platform; no hardcoded
  separators).
- `assertSafeSegment(workspaceKey)` already guards the path segment in
  content-store; the capture hook reuses the same safe derivation.

## Testing (TDD — red first)

| Unit | Test |
|------|------|
| Capture hook | stdin `UserPromptSubmit` JSON → correct file written, atomic (tmp+rename), correct shape `{prompt, ts}` |
| Capture hook | empty/whitespace prompt → no file written |
| `readSessionIntent` | missing → `undefined`; malformed → `undefined`; valid → prompt string; empty prompt → `undefined` |
| Precedence | explicit intent present → session file ignored; absent → session intent used |
| workspaceKey reuse | capture hook writes to the `encodeWorkspaceKey(cwd)` path (same helper `buildSaverDecision` reads from) |
| Cross-platform | path built with `node:path`, asserted structurally (not hardcoded `/`) |

## Risk

**MEDIUM** (§12). Ranking *input* changes, not the algorithm; keyword
weights locked. Required reviewer: `code-reviewer`. Regression
evidence required: with no `session-intent.json` present, hook-path
ranking output is unchanged from today (the fill-gap is inert without
a file).

**Escalation trigger:** if implementation ends up touching
`scoreChunk` / weights, stop and re-classify HIGH (architect +
critic + worktree).

## Definition of Done deltas

- Changeset (DoD #9): a new public CLI hook (`UserPromptSubmit`) is
  added → changeset required.
- No `CLAUDE.md` / convention changes expected (DoD #10) unless the
  hook install surface is documented there.
