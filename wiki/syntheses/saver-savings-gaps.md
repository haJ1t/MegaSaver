---
title: Saver Savings Gaps — everything blocking extra token saving
tags: [saver, hooks, gaps, bugs, token-savings, audit]
sources:
  - apps/cli/src/hooks/saver.ts
  - packages/connectors/claude-code/src/hook-settings.ts
  - workflow saver-gap-hunt wf_147629b1-073 (55 agents, 46 confirmed / 2 refuted, 2026-07-09)
status: active
created: 2026-07-09
updated: 2026-07-11
---

## TL;DR

Live-session verification (session `ae662232`, 2026-07-09): hooks fire, saver compresses Read
results 87–92%. But a 7-dimension adversarial audit confirmed **46 findings (14 bugs / 21 gaps /
11 edge cases)** that block further saving or silently negate it. Deduped below; every item was
independently verified against code by a refuter agent.

## A. Coverage — never compressed (matcher `Read|Bash|Grep|Glob|LS|WebFetch` + 6-entry `TOOL_SOURCE`, saver.ts:11-18, hook-settings.ts:8)

1. **Task/subagent final reports** — subagent-internal reads ARE compressed (hooks fire in subagents, verified live) but the report returned to the parent lands verbatim; §6 routing makes 5–30KB reports the norm.
   **Status:** FIXED — PR #276 (merged 2026-07-10)
2. **BashOutput/Monitor background retrieval** — §6 says run builds/tests in background; exactly those logs bypass the saver (foreground Bash is covered).
   **Status:** FIXED — PR #276 (merged 2026-07-10)
3. **All `mcp__*` tools** — saver.ts:9-10 comment "already proxied" is false for third-party servers (browser page dumps, memory search results enter raw).
   **Status:** FIXED — PR #276 (merged 2026-07-10)
4. **WebSearch, ToolSearch** — multi-KB snippet/schema blobs, raw.
   **Status:** FIXED — PR #276 (merged 2026-07-10)
5. **Grep default mode (`files_with_matches`) + all Glob** — filename arrays pass through uncapped (saver.ts:43-99,167); broad glob in monorepo = 30KB+ raw.
   **Status:** FIXED — PR #276 (merged 2026-07-10)
6. **Bash stderr never read** — only stdout measured (saver.ts:57-59); pnpm/cargo/webpack bulk on stderr leaks whole.
   **Status:** FIXED — PR #276 (merged 2026-07-10)
7. **Any non-text block in a content array disables compression for the entire payload** (saver.ts:72-81).
   **Status:** FIXED — PR #276 (merged 2026-07-10)

## B. Eligibility thresholds

8. **Aggressive dead band: 4001–7999 B never compresses** — token thresholds override mode budget; non-`compressed` decisions discarded (output-filter tokens.ts:17-18). This repo runs aggressive/4000 → the band is prime leak zone.
   **Status:** FIXED — PR #278 (merged 2026-07-10)
9. **Safe mode never compresses Bash**: 32000 B gate > Claude Code's ~30000-char Bash truncation ceiling (token-saver-mode.ts:21-22) — Desktop workspace (safe) saves 0 on commands.
   **Status:** FIXED — PR #278 (merged 2026-07-10)
10. **Hook path never passes `source` into `filterOutput`** — semantic AST chunking dead; every file read chunked at blind 40-line boundaries (classify.ts:55-65).
   **Status:** FIXED — PR #278 (merged 2026-07-10)

## C. Recovery path — dead end-to-end

11. **No Mega Saver MCP server registered in the session**, yet the footer instructs `proxy_expand_chunk(...)` — promise "Full output recoverable" is false in 100% of hook sessions (saver.ts:194-199). Real cost this session: agent misread footer as prompt injection, burned a turn.
   **Status:** FIXED — PR #276 (merged 2026-07-10)
12. **All-or-nothing chunk `"0"`** — expansion re-injects compressed + full raw, always worse than no compression (record-output.ts:136-144).
   **Status:** FIXED — PR #277 (merged 2026-07-10)
13. **Bash escape hatch re-compressed** → re-read loop; measured live: 10.4KB file cost 991 tok (compressed) + ~2600 tok (sliced re-reads).
   **Status:** FIXED — PR #276 (merged 2026-07-10)
14. **No retention/GC**; pruner cannot parse overlay chunk sets — orphan chunks from dead sessions accumulate forever (chunk-set.ts:16-36).
   **Status:** FIXED — PR #277 (merged 2026-07-10)
15. **One stray `.DS_Store` under `content/` breaks every chunk fetch** (locate-chunk-set.ts:18-20).
   **Status:** FIXED — PR #276 (merged 2026-07-10)

## D. Ranking quality — negative savings

16. **Kept excerpts rendered in SCORE order, bare `\n` joins, no elision markers, line numbers discarded** — spliced code parses as contiguous; agent mis-reasons (record-output.ts:66-68, fit.ts:5-29).
   **Status:** FIXED — PR #278 (merged 2026-07-10)
17. **Intent = workspace-global latest-wins file, never expires** — concurrent sessions/subagents rank against the wrong prompt; poisoned by task notifications (record-output.ts:99, rank.ts:114-124).
   **Status:** FIXED — PR #278 (merged 2026-07-10)
18. **Intent tokenizer ASCII-only** — Turkish prompts (this user) → ranking inert or mangled (rank.ts:65-69).
   **Status:** FIXED — PR #278 (merged 2026-07-10)
19. **This repo pinned aggressive/4000 by store records (exact+family match)** — HIGH-risk source repo compressed with evidence-dropping mode, contradicting §12 evidence-preserving rule (resolve-saver-settings.ts:128-136).
   **Status:** FIXED — PR #278 (merged 2026-07-10)
20. **Prose compressor truncates lists to 3 items, collapses non-first paragraphs** — wiki Sources/citation lists elided; breaks wiki-first startup reads (output-filter types.ts:260-263).
   **Status:** ACCEPTED (conscious) — see wave-3 spec (docs/superpowers/specs/2026-07-10-saver-eligibility-ranking-design.md)

## E. Silent failure — dead saver looks healthy

21. **Every hook failure is fail-open with zero failure telemetry** (saver.ts:143-159).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
22. **`mega doctor` says "installed" without verifying the saver hook exists or fires** (saver-telemetry.ts:26).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
23. **Hooks installed as bare `mega ...`** — no absolute path, no timeout; one PATH difference in the hook shell = exit 127, everything silently off (hook-settings.ts:6-9).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
24. **One corrupt/stale per-session stats summary disables compression for that session** while still writing orphan chunks (stats store.ts:174-189).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
25. **Stale heartbeat lock freezes liveness telemetry forever** — 1.13 anomaly alerts watch frozen timestamps (saver-heartbeat.ts:159-182).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
26. **Parallel tool calls race the summary read-modify-write** — savings undercounted (stats store.ts:219-234).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
27. **`mega hooks status <claude-session-uuid>` always "session not found"** — hooks never register live sessions (verified this session).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
28. **Telemetry log cwd-scoped, never aggregated** — nested stores (`~`, `~/Desktop`, repo) blind cross-session metrics (hooks store.ts:39).
   **Status:** FIXED — PR #279 (merged 2026-07-11)
29. **Hook processes hard-code default store** — operators using `--store` get a split brain.
   **Status:** FIXED — PR #279 (merged 2026-07-11)

## F. Metrics honesty

30. **~46–50 token footer per event excluded from returnedBytes/bytesSaved** — savings systematically over-reported (types.ts:340-345).
31. **Route drift kills metering forever** — settings rewrite removing `ANTHROPIC_BASE_URL` → monitorTick blocks + drains, never re-applies (supervisor.ts:267-269).
32. **One torn line in proxy `usage.jsonl` zeroes every future `mega audit usage` report** (proxy store.ts:50).
33. **`audit usage` scope mismatch**: per-cwd savings ÷ global proxy usage → wrong ratio with 2+ workspaces (usage.ts:129-132).
34. **HTTP proxy saves zero tokens** (passthrough + metering only, proxy-handler.ts:200) — never count it as a saver.

## Refuted (2)

- "WebFetch telemetry blind" — logger gap real but saver covers WebFetch; no token cost.
- "v1.12.0 trace/firewall JSON leak" — diff real, token impact disproven.

## Priority pointer

Highest-leverage fixes by leaked volume: A1 (Task reports), A2 (background output), A3 (MCP tools),
C11-13 (recovery), B8 (dead band), E23 (PATH fragility). Full 46-finding detail with verbatim
verifier verdicts: workflow output `wf_147629b1-073` (session artifact, not in repo).

## Release scope

**Targeted for the 2.0 release** (user directive, 2026-07-09): these fixes ship in 2.0 alongside
the E5 portable project brain ([[syntheses/pro-differentiation-portfolio]]).

**Progress (2026-07-11):** waves 1-4 merged to main (PRs #276-#279, fast-forward,
9f2caaf7 → aa1b285d). Of the 34 deduped items: A1-7, C11-15 fixed (#276/#277);
B8-10, D16-19 fixed (#278); E21-29 fixed (#279); D20 accepted (conscious).
29 of 34 addressed; remaining for 2.0: wave 5 (F30-34) — 5 items open.
