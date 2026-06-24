---
title: '@megasaver/llm-proxy'
tags: [entity, package, proxy, token-saver, conversation-tokens, v0.x]
sources:
  - docs/superpowers/specs/2026-06-24-llm-proxy-phase0-design.md
status: active
created: 2026-06-24
updated: 2026-06-24
---

# `@megasaver/llm-proxy`

Opt-in **local** Anthropic-API proxy. The tool-output saver (PostToolUse hook)
cannot touch the **conversation** stream (system prompt + full message history
re-sent every turn), so to save conversation tokens MegaSaver must sit in the
request path. This package is that path.

**Mission change:** §1 "Not a model proxy" was relaxed (user-authorized
2026-06-24) to "not a model proxy *by default*; an opt-in local proxy is
permitted." The "not an LLM-blinder" clause stays — Phase 0 strips nothing.

## Phase 0 shipped (transparent passthrough + token metering)

Claude Code CLI → `mega proxy start` (`ANTHROPIC_BASE_URL=http://127.0.0.1:8787`)
→ `api.anthropic.com`. Forwards every request **verbatim**, streams the response
back **unchanged**, and records each `/v1/messages` round-trip's real token
usage (`ProxyUsageEvent`: counts + model + ts + messageCount + stream).

- **Counts only** — never persists/logs request/response bodies, prompts, or
  auth headers (`x-api-key`/`authorization` forwarded verbatim, never recorded).
  Event schema is zod `.strict()`.
- **Loopback-only** bind (`127.0.0.1`, no `host` override) — it carries the
  operator's key.
- **Incremental SSE metering** — usage is scanned line-by-line as the stream
  flies past (`createSseUsageScanner`), so the terminal `message_delta` (real
  `output_tokens`) is captured even on multi-MB streams; no bounded buffer to
  overflow. Non-stream JSON is captured (bounded 5 MB). Request body bounded
  (50 MB → 413).
- **Backpressure** honored (`res.write` → `await once(res,"drain")`); a slow
  client can't balloon the proxy heap.
- **Anti-SSRF:** upstream is string-concat (`base + req.url`), never
  `new URL(path, base)`, so a hostile request-target stays a path under the
  pinned host — locked in by comment.
- Store: append-only JSONL `proxy-usage/usage.jsonl` under the store root.
- CLI: `mega proxy start [--port 8787] [--upstream …] [--store …]`.

Risk CRITICAL. Reviewed by security-reviewer (PASS w/ remediations — applied),
critic (SHIP w/ fixes — applied: the SSE-undercount BLOCKER + backpressure),
code-reviewer (with fixes — applied). 17 package tests + CLI wiring test; real
CLI smoke against a fake upstream confirms passthrough + counts-only recording.

## Next (not built)

- **Phase 1 — conversation compression:** rewrite the messages array (summarize
  /prune old turns + tool results) to actually *reduce* conversation tokens.
  Must preserve evidence (never drop the latest user turn / system block / break
  tool_use↔tool_result pairing). Separate spec.
- GUI surfacing of proxy usage; generalize beyond Claude Code CLI.

See [[entities/agent-office]], [[concepts/agent-agnostic-core]].
