---
title: Local LLM proxy — Phase 0 (transparent passthrough + token measurement)
status: approved
risk: CRITICAL
created: 2026-06-24
sign-off: user approved 2026-06-24 — explicitly authorized relaxing mission §1
  "Not a model proxy" to allow an opt-in local proxy; Claude Code CLI first;
  Phase 0 transparent (no compression); persist token counts only, not bodies.
sources:
  - docs/conventions/mission.md
  - packages/stats/src/event.ts
---

# Local LLM proxy — Phase 0

## Why (and the mission change)

The token saver compresses **tool output** (via a PostToolUse hook) but cannot
touch the **conversation** itself — the system prompt + full message history
re-sent every turn — because nothing lets a hook rewrite that stream. To save
conversation tokens we must sit in the request path: a **local proxy** that
Claude Code points `ANTHROPIC_BASE_URL` at.

This contradicts mission §1 "Not a model proxy." The user has explicitly
authorized relaxing that line to allow an **opt-in local proxy**. Mission §1's
other clause — "Not an LLM-blinder; we preserve evidence; we never strip what
the model needs to decide" — is **kept**: Phase 0 forwards everything verbatim
and strips nothing. (Compression that could blind the model is Phase 1, a
separate spec, and must preserve evidence.)

## Goal (Phase 0)

A transparent local proxy: Claude Code CLI → `mega proxy` → api.anthropic.com,
forwarding requests and streaming responses **unchanged**, while recording the
**real token usage** of each `/v1/messages` call (from Anthropic's `usage`).
This de-risks routing/streaming/auth and gives the first honest measurement of
conversation-token cost. No message rewriting.

## Architecture

New package `@megasaver/llm-proxy` (pure, injectable core) + a `mega proxy`
CLI command. Scaffolded like `packages/stats` (tsup, vitest, strict ESM).

### 1. `src/usage-event.ts`

`proxyUsageEventSchema` (zod `.strict()`):
- `id: string` (uuid), `ts: string` (ISO offset), `model: string`
- `inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens: int >= 0`
- `messageCount: int >= 0` (request `messages` length)
- `stream: boolean`
Type `ProxyUsageEvent`. **Counts + metadata only — never prompt/response text.**

### 2. `src/parse-usage.ts` (pure)

- `countRequestMessages(bodyText: string): { model: string; messageCount: number }`
  — parse the JSON request body (Anthropic Messages: `{model, system?, messages[]}`);
  on parse failure return `{model:"", messageCount:0}` (measurement is best-effort).
- `parseUsageFromJson(bodyText: string): UsageCounts | null` — non-stream response
  `{usage:{input_tokens, output_tokens, cache_read_input_tokens?, cache_creation_input_tokens?}}`.
- `parseUsageFromSse(sseText: string): UsageCounts | null` — accumulate from
  `message_start` (`message.usage` → input + cache tokens) and `message_delta`
  (`usage.output_tokens`). `UsageCounts = {inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens}`.

### 3. `src/proxy-handler.ts`

`createProxyHandler({ upstreamBaseUrl, upstreamFetch, onUsage, now, newId }): (req, res) => Promise<void>`
- Read method, path (`req.url`), headers, full body.
- Forward to `${upstreamBaseUrl}${path}` via injectable `upstreamFetch`
  (default global `fetch`), **same method, headers, body**. Drop only hop-by-hop
  (`host`, `connection`, `content-length` recomputed). Auth headers
  (`x-api-key`, `authorization`) forwarded **verbatim, never logged/persisted**.
- Write upstream status + headers to `res`; stream the body through **unchanged**.
  For an SSE/streamed body, tee a copy into a bounded buffer to parse usage; for a
  JSON body, capture it to parse usage. Passthrough bytes are never altered.
- After the response completes, if path starts with `/v1/messages` and method is
  POST: assemble a `ProxyUsageEvent` (request `messageCount`/`model` + parsed
  `usage` + `stream`) and call `onUsage(event)`. The whole measurement path is
  wrapped so a parse/record error **never** affects what the client received.
- Non-`/v1/messages` paths: forwarded the same way, no usage event.
- Upstream error/non-2xx: forwarded verbatim (status + body); no event; no crash.

### 4. `src/server.ts`

`startProxyServer({ host, port, upstreamBaseUrl, onUsage, now, newId }): { url, close }`
— `http.createServer(handler).listen(port, host)`. **Binds `127.0.0.1` only**
(never `0.0.0.0`). `url = http://127.0.0.1:<port>`.

### 5. `src/store.ts`

`appendProxyUsage({ storeRoot, event })` + `listProxyUsage({ storeRoot })` —
append-only JSONL at `proxy-usage/usage.jsonl` under the store root (atomic
append, zod-on-load), mirroring the stats/audit store pattern. Records the
event (counts only).

### 6. CLI — `mega proxy start`

`apps/cli`: new `proxy` command, sub `start`:
`mega proxy start [--port 8787] [--upstream https://api.anthropic.com] [--store …]`
→ `startProxyServer({...})` with `onUsage` → `appendProxyUsage`. Prints:
```
mega proxy listening on http://127.0.0.1:8787
point your agent at it:  export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
```
Foreground; Ctrl-C closes. A running tally line per recorded call (model +
input/output tokens) — counts only, no content.

## Security (CRITICAL)

- Bind `127.0.0.1` only.
- Auth headers forwarded untouched; **never** logged or persisted.
- Persist **only** token counts + model + ts + messageCount + stream — never the
  request/response bodies, system prompt, or messages.
- Default upstream pinned to `https://api.anthropic.com`; override explicit.
- Phase 0 mutates nothing in the request/response — strips nothing (mission's
  no-blinder clause holds).

## Out of scope (Phase 1+)

- Any message-history rewriting / summarization / pruning (the actual token
  *saving*) — separate spec; must preserve evidence + never drop the latest user
  turn, the system block, or break tool_use/tool_result pairing.
- GUI surfacing of proxy usage (a later panel/extension).
- Non-Claude-Code agents (generalize after CLI is proven).

## Testing (TDD, no real network)

- `parse-usage`: non-stream JSON usage extracted; SSE usage accumulated from a
  `message_start` + `message_delta` sample; `countRequestMessages` counts +
  reads model; malformed input → safe zero/null.
- `proxy-handler` (injected fake `upstreamFetch`, no real Anthropic):
  forwards method/path/headers/body verbatim; streams response back byte-equal;
  `onUsage` fires once with the correct counts for `/v1/messages`; a non-messages
  path forwards with no `onUsage`; an upstream 5xx is forwarded and does not
  crash; the auth header reaches the upstream call but appears in **no**
  `onUsage` event or persisted record.
- `store`: append then list round-trips; missing file → `[]`.
- CLI `proxy start`: with an injected server factory, prints the
  `ANTHROPIC_BASE_URL` line and routes `onUsage` to `appendProxyUsage`.

## Process / governance

- Edit `docs/conventions/mission.md` (relax §1) and run `pnpm conventions:sync`
  so CLAUDE.md / AGENTS.md / .cursor managed blocks regenerate; commit together.
- Add `@megasaver/llm-proxy` to the workspace (it is under `packages/*`, already
  globbed).
- Risk CRITICAL → worktree (no `main` edits), full TDD, `pnpm verify`,
  `security-reviewer` + `critic` + `code-reviewer` (separate fresh contexts),
  verifier evidence (a captured proxy round-trip against the fake upstream).
