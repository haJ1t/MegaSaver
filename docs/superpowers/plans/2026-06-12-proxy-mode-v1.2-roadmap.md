# MegaSaver Proxy Mode v1.2 — Complete Execution Roadmap

Date: 2026-06-12
Status: Commit-ready — full execution plan
Supersedes: the concise roadmap (its overview, ordering decisions, and guardrails are preserved below).
Source of truth: `MegaSaver_Proxy_Mode_v1.2_Design_Spec_Commit_Ready.md`
Locked decisions: (1) core savings metrics pulled forward into P2; (2) search (P3) before ranking (P4). See Part II §Ordering and Part VII.

Order: **P0** Naming → **P1** Classifier+ANSI → **P2** Compressors+savings → **P3** Search → **P4** Ranking → **P5** Hooks/Metrics/Connectors → **P6** Replay Trace.
Critical path to GA: **P0 → P1 → P2 → P4 → P5** (P3 parallel after P0; P6 trails P2+P4).


---

# Part I — Executive Overview

Both files are read. I have all source-of-truth context I need. The roadmap already locks the ordering, phase numbering, the D7 split decision, and the search-before-ranking decision. I'll produce the two requested cross-cutting sections in order, mapping spec acceptance criteria and respecting all hard constraints.

## Executive Summary

MegaSaver Proxy Mode v1.2 evolves the existing Context Gate / Mega Saver Mode stack into a public, measurable, agent-friendly feature that returns task-aware summaries, relevant excerpts, expandable chunks, and honest savings metrics for token-heavy coding-agent tool outputs — shipping a default-on `proxy_*` MCP naming mode (legacy `mega_*` behind a flag, never both at once), an ANSI-normalizing output classifier, Vitest + TypeScript compressors with a small-output passthrough rule, a new rg-first `proxy_search_code` tool, memory- and failure-history-aware ranking that reuses the existing LAMR/context-pruner scorer (no second engine), adoption/interception metrics that never overclaim, a Claude Code hook installer, and replay traces for future ablations — all by reusing content-store, audit/stats, redaction, command policy/allowlist, and output filtering rather than forking them. The single product claim: **"Others prune output. MegaSaver prunes with your project's memory."** Two engineering decisions are locked: **(1)** the core savings metrics (raw/returned tokens, saved %, passthrough count, classifier/compressor usage counts — "D7-core") are pulled forward out of PR 6 into **P2**, so each compressor ships self-proving with its own per-call savings number computed at compression time over existing audit/content-store, tightening the P2→P4 feedback loop and de-risking the demo; **(2)** search (**P3**) ships **before** ranking (**P4**) — a ranking-first variant was rejected because v1.2 ranking is the mechanism, not the proof (the proof is the v1.4 ablation benchmark, which depends on P6 replay traces, not on ranking landing a phase earlier), because the riskiest change in v1.2 is the shared-scorer extraction and it yields a better abstraction when designed against **both** consumers (compressor dispatch + search) already in place, and because Order A delivers a whole new user-visible capability one phase sooner than a thinner compressor-output-only ranking demo. **GA gate:** v1.2 is GA-ready only when the P0–P5 exit gates all pass; **P6** (replay-trace hardening) is required before v1.4 benchmark work but may trail GA.

## Milestones & Sequencing

Milestones M0–M6 are tied one-to-one to phase exit gates. There are no calendar dates — sequencing is relative only. A milestone is reached when its phase's exit gate is fully green **and** the cross-cutting guardrails (roadmap Section 10) still hold.

**Critical path to GA:** `P0 → P1 → P2 → P4 → P5` (M0 → M1 → M2 → M4 → M5).

**What parallelizes:**
- **P3 (M3) runs alongside P1/P2 once P0 lands.** P3 depends only on P0 (the `proxy_search_code` stub is registered in P0, implemented in P3); it does not depend on the classifier or compressors. So P3 can proceed concurrently with P1 and P2.
- **P4 (M4) is the join point.** It needs P1 (category context) and P3 in place, because the shared-scorer extraction is designed against **both** consumers — compressor dispatch (from P1/P2) and search output (from P3) — at once. This is exactly why Order A places search before ranking.
- **P6 (M6) trails P2 + P4.** Replay traces need real compressed responses (P2) and real candidate scores/selected chunks (P4) to record. P6 can be hardened after GA; it is required before v1.4.
- **P5 (M5) is a fan-in:** it depends on the full tool set P0–P4 to measure real adoption and interception, so it cannot start meaningfully until those land.

| Milestone | Phase exit | Gates | Parallelizable with |
|---|---|---|---|
| **M0 — Naming locked** | P0 (PR 1, D1) | Default `tools/list` exposes `proxy_*` only for renamed tools, no proxy+legacy duplicates; legacy mode shows `mega_*` only; both modes hit identical impl (behavior unchanged by switch); connector docs explain legacy opt-in; existing installs can pin legacy; `proxy_search_code` stub registered. | none (must ship first — gates P1, P3, P5) |
| **M1 — Output understood** | P1 (PR 2, D2) | Pipeline order `raw → store raw → strip ANSI → classify → compress → return` enforced; ANSI stripped before classify/compress, raw ANSI still stored + expandable; classifier exists *before* compressor dispatch; both command-matching and output-sniffing used; categories `vitest/typescript/generic_shell/unknown`; confidence recorded; low confidence → generic-filter fallback; result visible in debug/audit; fixtures pass (plain + ANSI Vitest default & verbose, ≥2 version variants if available, plain + `tsc --pretty` ANSI, mixed stdout/stderr, unknown). | M3/P3 (P3 needs only P0) |
| **M2 — Savings proven** | P2 (PR 3, D3 + D4 + **D7-core**) | Per compressor: raw stored in content-store, ANSI-normalized output used for compression, actionable failure detail + exit code preserved, chunks expandable, token savings measured. Vitest keeps failing names/assertions/stacks/paths/lines/summary/exit code, collapses passing/repeated/dup-frames/non-failing snapshots/noise; tsc keeps path/line-col/TS code/message/grouped errors/top files, collapses cascading dups/generic expansions. Passthrough rule (`<1200` minimal, `1200–2000` light summary + raw, `≥2000` full), configurable, audit records `passthrough`, no fake positive savings. **D7-core** per-call savings (raw/returned tokens, saved %, passthrough count, classifier-category count, compressor-usage count) recorded at compression time over existing audit/content-store and visible in `proxy_stats`. | M3/P3 |
| **M3 — Search shipped** | P3 (PR 4, D5) | rg-first: policy-gated `rg` over current filesystem is source of truth, index = enrichment only, never overrides live matches, never blocks on missing/stale index (`index_enrichment = unavailable` / `skipped_stale_index` + optional `mega index build` suggestion); works without index and with stale index; results grouped by file; noisy matches collapsed; task relevance applied; raw stored + expandable; respects existing command policy; metrics recorded; inputs `query/task/path_scope/max_results/max_tokens/include_globs/exclude_globs/context_lines`. | M1/P1 and M2/P2 (P3 needs only P0) |
| **M4 — Differentiator live** | P4 (PR 5, D6) | Shared scorer extracted/exposed (e.g. `packages/ranking-core` (illustrative — confirm in repo) or refactor of `packages/context-pruner/scoring` (illustrative — confirm in repo)) and called by Proxy Mode — **no second ranking engine**; v1.2 signals only `base_output_relevance + memory_boost + failure_history_boost`, all normalized to `[0,1]`, `final_score = 0.70*base + 0.15*memory + 0.15*failure`; behind `MEGASAVER_ENGINE_RANKING=true`, flag can fully disable; ranking explanation shows contributing signals; replay trace records candidate scores + selected chunks. | (join point — needs P1 + P3 in place) |
| **M5 — Measurable & adopted** | P5 (PR 6, **D7-rest** + D8 + D9) | `proxy_stats` shows universal metrics (adoption rate `proxy_calls / known_megasaver_calls`, call count, by-type, expand rate — plus P2's already-shipped savings surfaced on same dashboard); hook metrics appear only when log exists; dashboard separates adoption vs interception; `mega hooks install claude-code` installs `PreToolUse` telemetry (Read/Bash/Grep/Glob/LS → `.megasaver/hooks/claude-tool-calls.jsonl`, metadata-only), integrated with `mega mcp install claude` + Agent Setup Doctor (CLI & GUI); hook is fast/non-blocking/best-effort/always-exit-0/safe-if-`.megasaver`-missing-or-unwritable/never-logs-contents/never-blocks-tool; interception `proxy_eligible / (proxy_eligible + native_eligible_from_hook)` only when log exists, missing hook → adoption only + install suggestion (never claim universal interception without hook data); Setup Doctor detects hook installed/missing; missing hook never breaks stats; connector blocks (Claude Code, Cursor, Codex/Gemini/Aider where present) + MCP tool descriptions bias toward `proxy_*` (native only when required, expand chunks before assuming omitted content irrelevant); README says Proxy Mode is opt-in and avoids the "DFMT-style" headline. | (fan-in — needs P0–P4) |
| **M6 — Replay-ready** | P6 (PR 7, D10) | Trace per compressed response: session/project ID, task text, tool name, command/file/search query, classifier result + confidence, raw/returned token estimates, candidate + selected + omitted chunks, signal values, final scores, ranking mode/flags, compressor used, passthrough/compressed decision, later-linked expand events; references content-store IDs (no raw-output duplication); passthrough decisions get minimal-metadata traces; captures enough to replay ranking offline; supports v1.4 ablation ladder (baseline filter → +memory → +failure → +repo index → +dependency → full engine ranking). | (trails P2 + P4; may trail GA, required before v1.4) |

**GA cut line:** M0–M5 (P0–P5 exit gates) all green = v1.2 GA. M6 (P6) trails for v1.4 and does not block GA.

Source files (authoritative inputs for the above):
- Spec: `/Users/halitozger/Desktop/MegaSaver_Proxy_Mode_v1.2_Design_Spec_Commit_Ready.md`
- Roadmap: `/Users/halitozger/Desktop/MegaSaver_Proxy_Mode_v1.2_Roadmap.md`

---

# Part II — Phase Map, Ordering & Dependencies

## How to Read This Roadmap

- 7 phases (P0–P6), each maps to one shippable PR from the spec's recommended order.
- Each phase = independent merge unit with its own exit gate.
- A phase ships only when **every** acceptance criterion is green and the **cross-cutting guardrails** (Section 9) still hold.
- v1.2 is **GA-ready** only after P0–P5 exit gates pass. P6 hardens for v1.4 and can trail GA if needed.

Naming note: phase deliverable numbers below reference the spec's Deliverable 1–10 and PR 1–7.

---

## Phase Map (at a glance)

| Phase | Theme | PR | Deliverables | Size | Hard deps | Why this slot |
|---|---|---|---|---|---|---|
| **P0** | Tool Naming Mode | PR 1 | D1 | S–M | none | Locks public MCP schema. Changing later breaks connectors. |
| **P1** | Output Understanding | PR 2 | D2 | M | P0 | Compressor dispatch depends on classifier + ANSI strip. |
| **P2** | Compression Core + savings proof | PR 3 (+D7-core) | D3, D4, **D7-core** | M–L | P1 | Demo heart. Self-proves with per-call savings numbers. |
| **P3** | Code Search | PR 4 | D5 | M–L | P0 | New capability. rg-first, index optional. |
| **P4** | Memory-Aware Ranking | PR 5 | D6 | M | P1, P3 (shared scorer) | Core differentiator. Ranks compressor + search output. |
| **P5** | Adopt & Measure | PR 6 | **D7-rest**, D8, D9 | M | P0–P4 | Hook interception + adoption rate; biases agents to proxy tools. |
| **P6** | Replay Trace Hardening | PR 7 | D10 | M | P2, P4 | Prepares v1.4 benchmark/ablations. |

Legend: D = Deliverable, S/M/L = small/medium/large.

### Recommended order vs spec PR order

Spec PR order (1→7) is sound and kept as the backbone. **One surgical change:** Deliverable 7 (metrics) is **split**.

- **D7-core** (raw/returned tokens, saved %, passthrough count, classifier/compressor usage counts) moves **up into P2**. A compressor with no savings number cannot prove itself; the metric is cheap to compute at compression time and reuses existing audit/content-store. This tightens the feedback loop for P2→P4 and de-risks the demo.
- **D7-rest** (proxy adoption rate, hook-based interception rate) stays in **P5**, where the hook installer (D9) and connector instructions (D8) live — these need the full tool set shipped to measure real usage.

Everything else keeps spec order. Search (P3) stays **before** ranking (P4): lower risk per step, and ranking then upgrades both compressor and search output in one pass. No other reordering — extra shuffling would add risk without payoff.

**Decision (locked): Order A — search before ranking.** A ranking-first variant (P4 before P3) was evaluated and rejected:
- v1.2 ranking is the *mechanism*, not the *proof*. The proof that memory-aware ranking beats generic filtering is the **v1.4 ablation benchmark**, which depends on P6 replay traces — not on ranking shipping a phase earlier. So there is no "prove the differentiator early" payoff inside v1.2.
- The shared-scorer extraction is a **refactor of existing context-pruner code** — the single riskiest change in v1.2. It produces a better abstraction when designed against **both** consumers (compressor dispatch + search) already in place. Ranking-first designs it against compressor output alone, risking interface rework when search adopts it.
- Order A delivers a whole new user-visible capability (search) one phase sooner; ranking-on-compressor-output-only is a thinner intermediate demo.

---

## Dependency Graph

```txt
P0 (naming) ─────────────┬─────────────► P3 (search) ──┐
                         │                              │
                         └──► P1 (classifier) ──► P2 (compressors) ──┐
                                          │                          │
                                          └──────────► P4 (ranking) ◄┘
                                                            │
                              P2 + P4 ──────────────────────┴──► P6 (replay trace)

P0..P4 ───────────────────────────────────────────────────► P5 (metrics/hooks/connectors)
```

Critical path to GA: **P0 → P1 → P2 → P4 → P5**.
P3 runs parallel to P1/P2 once P0 lands. P6 trails P2+P4.

---

---

# Part III — Cross-Cutting Guardrails

## Cross-Cutting Guardrails (apply to every phase)

These are merge blockers regardless of phase:

1. **Evolve Context Gate. Do not rebuild it.** No new `packages/proxy` duplicating existing modules.
2. **No duplicate proxy + legacy tool names** in MCP `tools/list` by default.
3. **Reuse, don't fork:** chunk store, audit, redaction, command policy, output filtering, retrieval/indexing, stats/dashboard, command wrapper, ranking engine, MCP schema set.
4. **Memory-aware output pruning** is the differentiator — protect it.
5. **Honest metrics:** never claim universal interception without hook data.
6. **Raw always stored + expandable;** ANSI-normalized only for classify/compress.
7. **Public messaging:** "Others prune output. MegaSaver prunes with your project's memory." No niche competitor names in headlines.

---

---

# Part IV — Detailed Phase Plans (P0–P6)

## Phase P0 — Tool Naming Mode

### Objective

Introduce a single tool-naming mode flag (`MEGASAVER_TOOL_NAMING=proxy|legacy`, default `proxy`) so the MCP `tools/list` exposes exactly one name per underlying tool — `proxy_*` by default, `mega_*` only when legacy is selected — never both at once. This is a thin naming adapter over the existing tool implementations: switching modes changes only the exposed name and schema label, not behavior. It ships first because it sets the public MCP schema, and changing it after connectors are installed would break them (spec 5.4 final bullet, 15-PR1 "Why first").

### In Scope

- New env flag `MEGASAVER_TOOL_NAMING` with values `proxy` and `legacy`, default `proxy`, read once at MCP server startup.
- A thin naming adapter at the MCP `tools/list` / tool-registration boundary that maps the active mode to the exposed tool name + schema `name`/`title` for the affected tools.
- The name mapping from spec Section 5.3:
  - `proxy_read_file` ↔ `mega_read_file`
  - `proxy_run_command` ↔ `mega_run_command`
  - `proxy_expand_chunk` ↔ `mega_fetch_chunk`
  - `proxy_stats` ↔ existing stats/audit entry point (exact current registered name confirmed in repo)
  - `proxy_search_code` → new (name reserved + stub registered here; full implementation lands in P3)
- Guarantee that exactly one name set is listed at a time — no duplicate proxy + legacy schema entries for the same underlying tool.
- Tool descriptions adjusted so the active name is referenced consistently (descriptions that hard-code `mega_*` or `proxy_*` resolve to the active mode); description content otherwise unchanged.
- Connector docs: a short "Tool Naming Mode" section explaining default proxy mode and how existing installs opt into legacy.
- Invalid/unset value handling: unset/empty → default `proxy`; unrecognized value → fail safe to `proxy` with a one-line warning (does not crash server); case/whitespace handling defined explicitly (see Interfaces).
- Dispatch behavior for a tool name not present in the active mode (e.g. a stale connector calling `mega_read_file` while server is in proxy mode): defined as a normal MCP "unknown tool" error from the existing dispatch path — no crash, no cross-mode resolution.
- Tests proving single-name exposure, mode switch, behavior invariance, reserved-stub presence, and unknown-name handling.

### Out of Scope

- The actual implementation of `proxy_search_code` search/grouping/ranking/compression — deferred to **P3 (PR 4 / Deliverable 5)**. P0 only reserves the name and registers a stub schema.
- Output classifier, ANSI normalization — **P1 (PR 2 / Deliverable 2)**.
- Vitest/TypeScript compressors, passthrough rule, per-call savings metrics (D7-core) — **P2 (PR 3)**.
- Engine-aware ranking / shared scorer extraction (`MEGASAVER_ENGINE_RANKING`) — **P4 (PR 5 / Deliverable 6)**.
- Adoption rate, hook-based interception, hook installer, connector instruction-block rewrites that bias agents toward proxy tools — **P5 (PR 6 / Deliverables 7-rest, 8, 9)**. P0 renames the `proxy_stats` entry point but adds **no** new metric, no adoption/interception computation, and makes no interception claim (honest-metrics guardrail 5).
- Replay trace recording — **P6 (PR 7 / Deliverable 10)**.
- Per-tool deprecation of `mega_*` names (no removal of legacy; both names must remain *reachable* via the flag forever for compatibility). Any future "alias both at once" or per-tool override is explicitly **not** introduced; MCP has no true alias concept (spec 5.1), so v1.2 stays single-mode.
- Optional index-first/hybrid search backends — **v1.3** (spec 9.4).

### Work Breakdown

| ID | Task | Detail | Size |
|---|---|---|---|
| P0-T1 | Add `MEGASAVER_TOOL_NAMING` flag reader | Parse env once at MCP server init; accepted values `proxy`\|`legacy`; default `proxy`; unset/empty → `proxy`; trim surrounding whitespace; case-insensitive match (`PROXY`/`Legacy` accepted); any other value → coerce to `proxy` + one-line warning. Expose resolved mode as a single immutable config value consumed by the adapter. | S |
| P0-T2 | Define canonical name map | Single source-of-truth table mapping each underlying tool → `{proxy_name, legacy_name}` per spec 5.3. Include the four renamed tools + reserved `proxy_search_code`. **Confirm the real current registered name of the stats/audit entry point in repo and record it as `legacy_name` for `stats`.** No `mega_*` legacy counterpart for `proxy_search_code` (it is new). | S |
| P0-T3 | Build thin naming adapter at registration boundary | At `tools/list` and tool dispatch, resolve each tool's exposed `name` from the map using active mode. Exposed schema `name` and any `title` reflect active mode. Dispatch routes the active-mode name to the same existing handler. Adapter wraps the existing registration path — it does **not** introduce a second handler. | M |
| P0-T4 | Enforce single-set exposure | Guarantee `tools/list` emits exactly one name per underlying tool. Defensive assertion/guard that rejects any config producing both `proxy_*` and `mega_*` for the same impl (protects guardrail 2; fails server boot / fails the build). | S |
| P0-T5 | Register `proxy_search_code` stub | Reserve the name in proxy mode with a minimal valid schema; handler returns a clear structured "not implemented until P3" result. Decision: **listed-and-callable-but-non-functional** (not "registered disabled / hidden") so the name is stable and discoverable while inert. Confirm legacy mode does NOT expose any `mega_*` twin (it is new in v1.2). | S |
| P0-T6 | Normalize tool descriptions to active name | Ensure tool `description` text and any cross-references use the active-mode name, not a hard-coded prefix. Keep description content otherwise unchanged (no agent-bias rewrites — that is P5/D8). | S |
| P0-T7 | Connector docs: naming-mode section | Add a "Tool Naming Mode" doc block: default `proxy`, how to set `MEGASAVER_TOOL_NAMING=legacy`, why both are never listed, read-once/restart-to-change note, migration note for existing installs pinning legacy. | S |
| P0-T8 | Tests + fixtures | Unit: flag parsing (incl. case/whitespace/empty/garbage) + map resolution + reverse lookup. Integration: golden `tools/list` snapshot per mode; behavior-invariance test; no-duplicate assertion; stub presence + stub call; unknown-name dispatch; docs-present grep. | M |

### Interfaces & Contracts

**Env flag**

```txt
MEGASAVER_TOOL_NAMING=proxy|legacy
default:    proxy
unset       -> proxy
empty ""    -> proxy
"  proxy  " -> proxy        (surrounding whitespace trimmed)
"PROXY"     -> proxy        (case-insensitive)
"LEGACY"    -> legacy       (case-insensitive)
unknown     -> proxy        (log one-line warning; do not crash)
read:       once at MCP server startup (server restart required to change)
```

**Canonical name map (single source of truth)** — illustrative shape; confirm exact registry location in repo *(illustrative — confirm in repo)*:

```json
{
  "tools": [
    { "impl": "read_file",    "proxy_name": "proxy_read_file",    "legacy_name": "mega_read_file" },
    { "impl": "run_command",  "proxy_name": "proxy_run_command",  "legacy_name": "mega_run_command" },
    { "impl": "expand_chunk", "proxy_name": "proxy_expand_chunk", "legacy_name": "mega_fetch_chunk" },
    { "impl": "stats",        "proxy_name": "proxy_stats",        "legacy_name": "<existing stats/audit entry name — confirm in repo>" },
    { "impl": "search_code",  "proxy_name": "proxy_search_code",  "legacy_name": null, "stub": true }
  ]
}
```

Notes on the map:
- `stats` legacy name is the existing stats/audit entry point's currently-registered name (spec 5.3 says "existing stats/audit entry point"). It is **not** assumed to be `mega_stats`; P0-T2 confirms the real name in repo and the map carries that exact value. The single-source-of-truth map means one edit fixes every downstream consumer.
- `search_code` has `legacy_name: null` because it is new in v1.2 — legacy mode does not invent a `mega_*` twin for it.

**Naming adapter — function boundary** *(illustrative — confirm in repo)*:

```txt
resolveExposedName(impl: string, mode: "proxy"|"legacy") -> string | null
  proxy  -> map[impl].proxy_name
  legacy -> map[impl].legacy_name   (null -> tool omitted from legacy tools/list)

resolveImplFromExposedName(name: string, mode: "proxy"|"legacy") -> impl | null
  // reverse lookup, scoped to the ACTIVE mode only.
  // proxy mode resolves only proxy_* names; legacy mode resolves only mega_* names.
  // A name belonging to the inactive mode -> null -> existing dispatch returns
  //   a standard MCP "unknown tool" error (no cross-mode fallback, no crash).
```

The adapter wraps the **existing** registration/dispatch path. It MUST NOT duplicate tool handlers — the same handler is invoked regardless of exposed name (spec 5.2 "both naming modes call the same underlying implementation"). Reverse lookup is **mode-scoped on purpose**: cross-mode resolution would re-introduce both names as reachable simultaneously, violating guardrail 2.

**`tools/list` output contract**

```txt
mode=proxy  -> list contains: proxy_read_file, proxy_run_command, proxy_expand_chunk,
                              proxy_stats, proxy_search_code (stub)
               list contains NO mega_* (or existing-stats) entry for those impls.
mode=legacy -> list contains: mega_read_file, mega_run_command, mega_fetch_chunk,
                              <existing stats entry name>
               list contains NO proxy_* entry for those impls.
               proxy_search_code (new tool) NOT exposed (no mega_* twin).
Invariant: for every underlying impl, |exposed names in tools/list| == 1
           (search_code: 1 in proxy mode, 0 in legacy mode).
```

**`proxy_search_code` stub schema** (P0 reserves only; full I/O in P3) *(illustrative — confirm in repo)*:

```json
{
  "name": "proxy_search_code",
  "description": "Task-aware code search (registered; full implementation in v1.2 P3).",
  "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }
}
```

Stub handler contract: appears in `tools/list` with a valid schema and is callable; when called it returns a structured "not yet implemented in this build (P3)" result, never throws, never partially executes a search, and writes no content-store/audit side effects. The stub is **not** registered as hidden/disabled — the name must be discoverable so connectors and P3 build against a stable schema.

### Module Touchpoints

- **MCP tool registration / `tools/list` layer** (the existing `mega_*` registration surface, spec Section 3 "existing `mega_*` MCP tools") — primary touchpoint; the naming adapter wraps it. *(illustrative path — confirm in repo)*
- **content-store** — untouched; named only to confirm `proxy_expand_chunk` → `mega_fetch_chunk` still routes to the same chunk-fetch impl.
- **stats/audit system** — untouched logic; `proxy_stats` maps to the existing stats/audit entry point. No new metric added in P0 (honest-metrics guardrail 5).
- **policy layer / command allowlist** — untouched; `proxy_run_command` → `mega_run_command` still routes through the existing command policy (guardrail 3).
- **redaction pipeline** — untouched; renaming does not alter the redaction path any tool's output already passes through.
- **Context Gate / output-filter / context-pruner / packages/ranking-core** — NOT touched in P0 (named only to assert no duplication; evolve-not-rebuild guardrail 1).
- **Connector docs** (README / connector install docs) — add naming-mode section only.

### Test Strategy

- **Unit — flag parsing (P0-T1):** `proxy`→proxy, `legacy`→legacy, unset→proxy, `""`→proxy, `"  proxy  "`→proxy, `"PROXY"`→proxy, `"LEGACY"`→legacy, `garbage`→proxy + warning emitted. Pass: each input yields the expected resolved mode; warning emitted exactly on the coerced/unknown case; no throw on any input.
- **Unit — name-map resolution (P0-T2/T3):** `resolveExposedName(impl, mode)` returns the correct name for all five impls in both modes; `search_code` in legacy resolves to `null` (omit). `resolveImplFromExposedName(name, mode)` is mode-scoped: a proxy name resolves only in proxy mode and a legacy name only in legacy mode; an inactive-mode name returns `null`. Pass: every mapping matches the spec 5.3 table; cross-mode lookups return `null`.
- **Integration — golden `tools/list` snapshot per mode:** boot server in proxy mode, snapshot `tools/list`; boot in legacy mode, snapshot. Pass: proxy snapshot contains only `proxy_*` names (no `mega_*`/existing-stats for those impls); legacy snapshot contains only the `mega_*`/existing-stats names (no `proxy_*`).
- **Integration — no-duplicate invariant (guardrail 2):** for each underlying impl, assert exactly one exposed name appears in `tools/list` in the active mode (search_code == 0 in legacy). Also assert the P0-T4 defensive guard fails boot/build if a map is constructed that exposes both names for one impl. Pass: count == 1 per impl; deliberately-broken map is rejected.
- **Integration — behavior invariance (spec 5.4 / 14-D1):** invoke the same impl via its proxy name (proxy mode) and via its legacy name (legacy mode) with identical inputs; compare results/side-effects modulo the tool name. Pass: identical behavior — mode changes exposed name only, not behavior.
- **Integration — same-handler proof:** assert both exposed names dispatch to the identical handler reference/path (no duplicated handler). Pass: one handler, two possible names; protects evolve-not-rebuild guardrail 1.
- **Integration — stub presence + call:** in proxy mode `proxy_search_code` is listed with a valid schema; calling it returns the structured "not implemented (P3)" result without throwing, without running a search, and without content-store/audit writes. In legacy mode no `mega_search_code` (or any twin) appears. Pass: stub listed+callable+inert in proxy, absent in legacy.
- **Integration — unknown / inactive-mode name dispatch:** in proxy mode, calling `mega_read_file` (an inactive-mode name) returns a standard MCP "unknown tool" error, not a crash and not a cross-mode resolution. Pass: graceful unknown-tool error.
- **Docs check:** connector docs contain a "Tool Naming Mode" section referencing `MEGASAVER_TOOL_NAMING=legacy`. Pass: section present (lint/grep test).

### Fixtures

P0 is a schema/naming phase — no command-output fixtures (those are mandatory in P1/P2). Test data/fakes needed:

- **Golden `tools/list` JSON snapshots** — one for `mode=proxy`, one for `mode=legacy`, used by the integration snapshot tests. Each lists the exact expected tool `name`s and asserts absence of the opposite prefix for shared impls.
- **Name-map fixture** — the canonical impl↔name table (P0-T2) as test data driving parametrized resolution tests, including the placeholder `<existing stats entry name>` resolved to the confirmed repo value.
- **Deliberately-broken map fixture** — a map that exposes both `proxy_*` and `mega_*` for one impl, used to prove the P0-T4 guard rejects it.
- **Env-value table** — `[("proxy","proxy"),("legacy","legacy"),(unset,"proxy"),("","proxy"),("  proxy  ","proxy"),("PROXY","proxy"),("LEGACY","legacy"),("foo","proxy"+warn)]` driving flag-parse tests.
- **Fake/minimal tool handlers** if needed to run `tools/list` without real filesystem/command side effects, or reuse the existing test harness server boot. *(illustrative — confirm test harness in repo)*
- **`proxy_search_code` stub schema fixture** — expected reserved schema for the stub-presence assertion.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Adapter accidentally lists both proxy + legacy names (violates guardrail 2). | P0-T4 defensive invariant fails boot/build; integration no-duplicate test + deliberately-broken-map fixture lock it in. |
| Handler logic gets duplicated per name instead of shared. | Adapter wraps existing single handler; same-handler proof test + behavior-invariance test catch divergence; code review against evolve-not-rebuild guardrail 1. |
| Existing connector installs break when default flips to `proxy`. | Legacy mode preserved and documented; connector docs give exact `MEGASAVER_TOOL_NAMING=legacy` opt-in for pinned installs (spec 14-D1 "existing installations can opt into legacy mode"). |
| Stale connector still calls a `mega_*` name while server is in proxy mode. | Inactive-mode name returns standard MCP unknown-tool error (mode-scoped reverse lookup), never a crash; documented so operators pin legacy if they cannot update the connector. |
| Exact current name of the stats/audit entry point and the `tools/list` registration path are unknown in this environment. | Marked illustrative; P0-T2 confirms the real existing stats name in repo before wiring; single-source-of-truth map means one edit propagates everywhere. |
| Renaming changes tool descriptions and unintentionally rewrites agent-bias copy (P5/D8 territory). | P0-T6 scope is name normalization only; agent-bias description rewrites explicitly deferred to P5/D8. |
| `proxy_search_code` stub looks functional and an agent calls it expecting results. | Stub returns explicit structured "not implemented until P3" result with no side effects; description marks it as reserved. |
| Touching `proxy_stats` naming gets mistaken for adding a metric (honest-metrics guardrail 5). | P0 renames the entry point only; no adoption/interception metric, no interception claim — added explicitly to Out of Scope and Exit Gate. |
| Env read only at startup confuses users toggling at runtime. | Document "restart server to change mode" in connector docs; read-once is intentional for schema stability. |

### Exit Gate

Maps every PR 1 / Deliverable 1 acceptance criterion (spec 5.4, 14-D1, 15-PR1, 16, 20):

- [ ] `MEGASAVER_TOOL_NAMING=proxy|legacy` flag exists and defaults to `proxy`. (spec 5.2, 14-D1) — *AS1, AS5*
- [ ] Default MCP `tools/list` exposes `proxy_*` names only for the renamed tools — not duplicate proxy + legacy names. (spec 5.4, 14-D1, 15-PR1) — *AS1, AS4*
- [ ] Legacy mode exposes the old `mega_*` names only (incl. the existing stats entry name). (spec 5.4, 14-D1) — *AS2, AS4*
- [ ] No duplicated schema entries for the same underlying tool in either mode. (spec 5.4, 14-D1) — *AS4*
- [ ] Both naming modes call the same underlying implementation. (spec 5.2, 14-D1) — *AS3*
- [ ] Changing naming mode does not change behavior, only exposed names. (spec 5.4) — *AS3*
- [ ] Legacy mode remains available for existing connector installs / existing installations can opt into legacy mode. (spec 5.4, 14-D1) — *AS2*
- [ ] Connector docs explain how to use legacy mode / the naming mode. (spec 5.4, 14-D1, 15-PR1) — *AS9*
- [ ] "PR 1 implements this because changing it later would break connectors" — naming is locked first; read-once-at-startup contract documented. (spec 5.4 final bullet, 15-PR1) — *AS8, AS9*
- [ ] Unknown / unset / empty / cased flag values resolve safely to `proxy` without crashing; unknown value warns. (spec 5.2 default behavior, defensive) — *AS5, AS6*
- [ ] Inactive-mode tool name yields a graceful unknown-tool error, not a crash or cross-mode resolution. (defensive; protects guardrail 2) — *AS10*
- [ ] `proxy_search_code` name reserved/registered (stub) here without breaking the no-duplicate rule; callable but inert; full impl deferred to P3. (roadmap §3 build; spec 5.3 "new") — *AS7*
- [ ] `proxy_stats` maps to the existing stats/audit entry point; P0 adds no new metric and makes no interception claim. (spec 5.3; honest-metrics guardrail 5) — *AS2, AS11*
- [ ] Guardrail: no duplicate proxy + legacy tool names listed in MCP by default. (spec 20 "most important schema rule"; guardrail 2) — *AS4*
- [ ] Guardrail: thin naming adapter only — no parallel proxy stack, no logic/handler duplication; content-store, policy, redaction, stats reused not forked. (spec 2, 20 "Evolve Context Gate. Do not rebuild it."; guardrails 1, 3) — *AS3, AS11*

### Acceptance Scenarios

- **P0-AS1 (happy path — default proxy):** Given `MEGASAVER_TOOL_NAMING` is unset, When the MCP server starts and an agent calls `tools/list`, Then the list contains `proxy_read_file`, `proxy_run_command`, `proxy_expand_chunk`, `proxy_stats`, `proxy_search_code` and contains no `mega_*`/existing-stats entry for those impls.
- **P0-AS2 (legacy opt-in):** Given `MEGASAVER_TOOL_NAMING=legacy`, When the server starts and `tools/list` is called, Then the list contains `mega_read_file`, `mega_run_command`, `mega_fetch_chunk`, and the existing stats entry name, and contains no `proxy_*` entry for those impls. (`proxy_stats` maps to that same existing stats/audit impl — no metric added.)
- **P0-AS3 (behavior invariance / same handler):** Given the same input file path, When `proxy_read_file` is invoked in proxy mode and `mega_read_file` is invoked in legacy mode, Then both return identical content/behavior because they route to the same handler; And no second handler exists.
- **P0-AS4 (no-duplicate invariant):** Given either mode, When `tools/list` is inspected, Then every underlying impl is exposed under exactly one name (search_code: one in proxy, zero in legacy) — never both prefixes; And the P0-T4 guard rejects any config that would expose both.
- **P0-AS5 (flag disabled / unset / empty):** Given `MEGASAVER_TOOL_NAMING` is unset or empty, When the server starts, Then it defaults to proxy mode without error (flag-absent is a valid, well-defined state).
- **P0-AS6 (invalid / cased value):** Given `MEGASAVER_TOOL_NAMING=foo` (or `PROXY` with stray whitespace), When the server starts, Then `foo` coerces to `proxy` with a one-line warning and a cased/whitespaced valid value resolves to its mode, in all cases serving a valid `tools/list` with no crash.
- **P0-AS7 (reserved stub — new tool, no legacy twin):** Given proxy mode, When `proxy_search_code` is listed and then called, Then it appears with a valid schema but returns an explicit structured "not implemented until P3" result with no search executed and no side effects; And in legacy mode no `mega_search_code` (or any twin) is exposed.
- **P0-AS8 (runtime toggle expectation):** Given the server is running in proxy mode, When the operator changes `MEGASAVER_TOOL_NAMING=legacy` without restarting, Then the exposed names do not change until restart, matching the documented read-once-at-startup contract.
- **P0-AS9 (connector docs present):** Given a fresh checkout, When connector docs are inspected, Then a "Tool Naming Mode" section documents default proxy, the `MEGASAVER_TOOL_NAMING=legacy` opt-in for existing installs, and the restart-to-change note.
- **P0-AS10 (inactive-mode name dispatch):** Given proxy mode, When a stale connector calls `mega_read_file`, Then dispatch returns a standard MCP "unknown tool" error (mode-scoped reverse lookup) without crashing and without resolving the legacy name.
- **P0-AS11 (no new metric / no interception claim):** Given P0 is complete, When `proxy_stats` is inspected, Then it surfaces the existing stats/audit output unchanged under the new name, with no adoption-rate, no hook-based interception rate, and no universal-interception claim introduced (honest-metrics guardrail 5; those land in P5).

### Dependencies / Rollback / Estimate

**Dependencies.** Upstream: none — P0 has no hard deps and ships first (roadmap §1, §2; spec 15-PR1 "Why first"). It only requires the existing `mega_*` tool registration surface, content-store, stats/audit, and policy layer to already exist (they do). Downstream: P0 unblocks the entire tree — both P1 and P3 depend on P0 (dependency graph: `P0 → P1`, `P0 → P3`); the reserved `proxy_search_code` stub is the seam P3 fills; the `proxy_stats` naming is the seam P2's D7-core and P5's metrics surface through.

**Rollback / feature-flag plan.** The phase *is* a feature flag: `MEGASAVER_TOOL_NAMING`. Rollback for any connector that breaks under the new default is pinning `MEGASAVER_TOOL_NAMING=legacy` — restoring the exact pre-v1.2 `mega_*` schema with identical behavior, no code revert required. Full revert (remove the adapter) is low-risk because the adapter is a thin wrapper over unchanged handlers; reverting restores the original single `mega_*` registration. Because the flag is read once at startup, rollback is a config + restart, not a redeploy.

**Estimate.** Small–Medium, matching spec 15-PR1 ("small-medium") and roadmap (S–M). Justification: the logic is a thin name-resolution adapter plus a single source-of-truth map — no new tool behavior, no compressor/classifier/ranking work. The bulk of effort is the no-duplicate invariant, the golden `tools/list` snapshot tests per mode, the behavior-invariance + same-handler proofs, confirming the real stats entry-point name and registration path in the repo, the inactive-mode dispatch handling, and the `proxy_search_code` stub reservation. Risk is concentrated in getting the single-set exposure invariant airtight, since this schema is the contract every later phase and every installed connector builds on.

---

## Phase P1 — Output Classifier + ANSI Normalization

### Objective
Introduce a deterministic output-understanding stage that runs between raw-output storage and any compressor: store raw stdout/stderr unchanged in content-store, strip ANSI for analysis only, then classify the normalized text into exactly one of `vitest | typescript | generic_shell | unknown` using both command-matching and output-sniffing. The classifier emits a category plus a confidence score; low-confidence results fall back safely to the existing generic output filter, and the classifier result (category, confidence, signals that fired, raw content ID) is recorded in debug/audit. This phase ships **no compressor** — it is the dispatch precondition for P2 (spec sec 10, sec 14-D2, sec 15-PR2). Honesty constraint: P1 does not measure or claim any token savings (that is D7-core, owned by P2); it only classifies.

### In Scope
- ANSI normalization step (strip CSI/SGR/OSC escape sequences, carriage-return overwrite handling, backspace, bell) applied to a **copy** of the output for classify/compress only — never to stored bytes (spec sec 10.2).
- Raw-output storage into the existing content-store **before** stripping, returning a stable content/chunk ID for later expansion via the existing `proxy_expand_chunk` path (spec sec 10.2, sec 10.6).
- Classifier module: inputs = command string, exit code, stdout, stderr, file path (if applicable), tool type; output = `{ category, confidence, signals, source, rawContentId }` (spec sec 10.3, sec 14-D2).
- Dual-signal classification (spec sec 10.3):
  - **command-matching**: `vitest`, `npm test`, `pnpm test`, `yarn test`, `tsc`, `tsc --noEmit`, `npm run typecheck`, `pnpm typecheck`.
  - **output-sniffing** on ANSI-stripped text — Vitest markers: `FAIL`, `Test Files`, `Tests`, `Duration`, `AssertionError`, `Serialized Error`; TypeScript markers: `error TS`, `.ts(`, `.tsx(`, `Found X errors`.
- The **four** v1.2 categories are all reachable: `vitest` and `typescript` from signals; `generic_shell` for output that has no test/tsc signals but is non-empty, recognizable shell output; `unknown` as the safe low-confidence/empty fallback (spec sec 10.4). `generic_shell` and `unknown` are **distinct** categories, not synonyms.
- Confidence scoring and a low-confidence threshold that routes to `unknown` → generic fallback (spec sec 10.6, sec 14-D2).
- Dispatch hook point: classifier runs **before** compressor dispatch; the dispatch table is wired so every category maps to the existing generic output filter (compressors land in P2), keeping the pipeline exercisable end-to-end (spec sec 10.6).
- Classifier result surfaced in debug/audit mode: category, confidence, which signals fired, raw content-store ID (spec sec 14-D2).
- Fixture corpus + unit/fixture tests covering plain and ANSI variants, default and verbose Vitest reporters, ≥2 Vitest version variants, `tsc --pretty`, mixed stdout/stderr, generic shell, unknown/empty output (spec sec 10.5).

### Out of Scope
- All compressor logic — Vitest compressor (Deliverable 3) and TypeScript compressor (Deliverable 4) land in **P2**. P1 only dispatches to the generic filter; it does not summarize/collapse output.
- The small-output passthrough rule (spec sec 11) — owned by **P2**; P1 stores raw and classifies regardless of size.
- Token-savings / compression-ratio measurement (D7-core, spec sec 7.2-A / Deliverable 7) — **P2**. P1 emits no savings number (honesty: a classifier alone saves nothing).
- v1.3 categories: `eslint`, `jest`, `playwright`, `next_build`, `git_diff`, `git_status`, `build_log`, `generic_log` (spec sec 10.4 explicitly defers these to **v1.3**). P1 must not leak any of these into the category enum.
- Engine-aware ranking / shared scorer (Deliverable 6) — **P4**. No scorer is touched here; the confidence fusion in P1 is a fixed-weight classifier heuristic, **not** a second ranking engine (guardrail 3).
- Replay-trace recording (Deliverable 10) — **P6**; P1 only ensures the classifier emits `{category, confidence, rawContentId}` in a shape the trace can later reference.
- Adoption / hook-based interception metrics (D7-rest, Deliverable 7) — **P5**.
- `proxy_search_code` classification of search output (Deliverable 5) — **P3**; P1 classifies command stdout/stderr only.
- Missing/stale-index behavior (spec sec 9.3) and missing-hook-log behavior (spec sec 13.6) — P3 and P5 respectively; P1 must merely not break when absent.

### Work Breakdown
| ID | Task | Detail | Size |
|---|---|---|---|
| P1-T1 | ANSI normalizer | `stripAnsi(input)` removing SGR/CSI/OSC sequences; handle `\r` line-overwrite (progress spinners), `\b` backspace, and bell `\x07`. Pure, no deps beyond a vetted strip-ansi or inline regex. Returns normalized string only; never mutates input or stored bytes. | S |
| P1-T2 | Raw-store-first wiring | Persist raw stdout+stderr (with original ANSI) into content-store **before** normalization; obtain `rawContentId`; never mutate stored bytes. Reuse existing content-store API — assert exactly one raw copy. | S |
| P1-T3 | Classifier types/interface | Define `ClassifierInput`, `ClassificationResult` (`category`, `confidence`, `signals[]`, `source`, `rawContentId`). Category enum is closed at exactly `vitest | typescript | generic_shell | unknown` (lint/test guards no fifth value). | S |
| P1-T4 | Command matcher | Tokenize/normalize command string; match Vitest and tsc/typecheck patterns from spec sec 10.3 (incl. `tsc --noEmit`, `npm run typecheck`, `pnpm typecheck`, package-manager `test` scripts). Handle wrappers/prefixes (`npx`, `cross-env FOO=1`, `&&` chains). Returns weighted command signal. | M |
| P1-T5 | Output sniffer | Marker checks on ANSI-stripped text for the full Vitest marker set (incl. `Serialized Error`) + TypeScript set (incl. `.tsx(` and `Found X errors` numeric regex `/Found \d+ errors?/`). Returns weighted output signals; absence → zero. | M |
| P1-T6 | Confidence + fusion | Combine command + sniff signals into normalized `confidence` in `[0,1]`; apply low-confidence threshold → `unknown`. Deterministic, documented fixed weighting — **not** the shared scorer (guardrail 3). | M |
| P1-T7 | Dispatch integration | Insert classifier call into the `proxy_run_command` output path **after** raw store, **before** compressor dispatch; wire a category→handler table defaulting **all four** categories to the existing generic output filter (compressors plugged in P2). | M |
| P1-T8 | Debug/audit surfacing | Emit `{stage:"classify", category, confidence, signalsFired, rawContentId, fallback}` into existing stats/audit debug channel; gated by debug flag. No new audit store. | S |
| P1-T9 | Fixture corpus | Author all fixtures in spec sec 10.5 (see Fixtures section). Store raw bytes incl. real ANSI; each fixture carries an asserted expected `category`. | M |
| P1-T10 | Test suite | Unit (normalizer, matcher, sniffer, fusion) + fixture-driven classification + pipeline integration (raw stored pre-classify, ANSI stripped pre-classify, classify pre-dispatch, fallback path, flag-off bypass). | M |
| P1-T11 | Feature-flag guard | Wrap classifier dispatch behind `MEGASAVER_OUTPUT_CLASSIFIER`; `off` reproduces pre-P1 generic behavior with no code revert; raw store + expand unaffected in both states. | S |

### Interfaces & Contracts

Env flags introduced/used by this phase:
```txt
MEGASAVER_OUTPUT_CLASSIFIER=on|off      # default: on. off → bypass classifier, route all output to generic filter (pre-P1 behavior). Raw store + expand unaffected.
MEGASAVER_CLASSIFIER_MIN_CONFIDENCE=0.5 # default: 0.5. fused confidence below this → category coerced to "unknown"
MEGASAVER_DEBUG_CLASSIFIER=true|false   # default: false. emits classifier metadata to existing debug/audit channel
```

Classifier input/output contract (TypeScript, illustrative — confirm in repo):
```ts
export type OutputCategory = 'vitest' | 'typescript' | 'generic_shell' | 'unknown';
// CLOSED enum — exactly the v1.2 set (spec sec 10.4). No v1.3 categories. A type/lint guard fails the build on any fifth value.

export interface ClassifierInput {
  command: string;          // full command string, e.g. "pnpm vitest run"
  exitCode: number | null;  // process exit code; null if unknown
  stdout: string;           // raw stdout (ANSI may be present)
  stderr: string;           // raw stderr (ANSI may be present)
  filePath?: string;        // when output is tied to a file (optional)
  toolType: 'run_command' | 'read_file' | 'search_code' | string;
}

export interface ClassificationSignal {
  source: 'command' | 'output';
  stream?: 'stdout' | 'stderr'; // which stream the output marker fired on (for mixed-stream audit)
  marker: string;               // e.g. "vitest", "error TS", "Test Files", "Serialized Error"
  weight: number;               // contribution in [0,1]
}

export interface ClassificationResult {
  category: OutputCategory;
  confidence: number;              // normalized [0,1]
  signals: ClassificationSignal[]; // signals that fired (for audit/explanation)
  source: 'command' | 'output' | 'fused' | 'fallback';
  rawContentId: string;            // content-store ID of the unmodified raw output
}
```

Core function boundaries (illustrative — confirm in repo):
```ts
// ansi-normalize: pure, used only for classify/compress; never mutates stored raw.
// Guarantees: idempotent, removes SGR/CSI/OSC + \r/\b/\x07, leaves no \x1b byte.
export function stripAnsi(input: string): string;

// classifier entrypoint; assumes raw already stored, receives content ID.
export function classifyOutput(
  input: ClassifierInput,
  rawContentId: string,
  opts?: { minConfidence?: number }
): ClassificationResult;
```

Dispatch contract (output-filter touchpoint, illustrative — confirm in repo):
```ts
// runs INSIDE proxy_run_command path, AFTER raw store, BEFORE compressor dispatch
type CompressorHandler = (normalized: string, input: ClassifierInput, rawContentId: string) => CompactResult;
const dispatch: Record<OutputCategory, CompressorHandler>;
// P1: ALL FOUR keys (vitest, typescript, generic_shell, unknown) map to the genericOutputFilter handler.
// P2 replaces the vitest/typescript entries with real compressors; generic_shell/unknown stay on the generic filter.
```

Debug/audit record shape (appended to existing audit stream, not a new store):
```json
{
  "stage": "classify",
  "category": "vitest",
  "confidence": 0.92,
  "signalsFired": [
    { "source": "command", "marker": "vitest", "weight": 0.5 },
    { "source": "output", "stream": "stdout", "marker": "Test Files", "weight": 0.3 }
  ],
  "rawContentId": "cs_8f21ab",
  "fallback": false
}
```

No MCP `tools/list` signature changes in P1 — the classifier is internal to the `proxy_run_command` path established in P0. No new `proxy_*`/`mega_*` tool names are added; no `mega_*` name is re-exposed (guardrail 2 preserved).

### Module Touchpoints
- **output-filter** — primary host of the classify→dispatch stage; gains the classifier call and category→handler table (all four handlers default to generic filter until P2). (illustrative path: `packages/output-filter/` — confirm in repo)
- **content-store** — reused unchanged for raw-output storage-before-strip; returns the `rawContentId`. No new store, no second raw write. (illustrative path: `packages/content-store/` — confirm in repo)
- **Context Gate / Mega Saver Mode** — the command-output flow into which the classify stage is inserted; evolved, not rebuilt (guardrail 1). (illustrative — confirm in repo)
- **stats/audit** — reused for the debug/audit classifier record; no parallel audit stream. (illustrative path: `packages/stats-audit/` — confirm in repo)
- **policy layer / command allowlist** — not modified; command strings the classifier reads come through the existing policy-gated wrapper. The classifier never executes commands and introduces no bypass. (illustrative — confirm in repo)
- **new code (additive, no duplication):** ANSI normalizer + classifier inside output-filter (e.g. `packages/output-filter/classify/` and `.../ansi/`). Not a new `packages/proxy`. (illustrative — confirm in repo)
- **Not touched in P1:** context-pruner / `packages/ranking-core` (P4 — no scorer reuse here), redaction pipeline (no new raw paths created; raw already flows through the existing redaction-aware store), `proxy_search_code` (P3).

### Test Strategy
- **Unit — ANSI normalizer (P1-T1):** feed strings with SGR color, cursor-move CSI, OSC title set, `\r` progress overwrite, `\b`, bell. Pass: output equals expected plain text byte-for-byte; idempotent (`strip(strip(x)) === strip(x)`); no escape byte remains (`/\x1b/` absent); empty/whitespace input returns unchanged.
- **Unit — command matcher (P1-T4):** each spec sec 10.3 command string + wrapper variants → expected command signal. Pass: `vitest`/`npm test`/`pnpm test`/`yarn test`/`npx vitest run` → vitest signal; `tsc`/`tsc --noEmit`/`npm run typecheck`/`pnpm typecheck` → typescript signal; `&&`-chained and env-prefixed commands resolve to the dominant tool; unrelated commands (`ls`, `curl`) → no test/tsc signal.
- **Unit — output sniffer (P1-T5):** every Vitest marker incl. `Serialized Error`, and every TypeScript marker incl. `.tsx(` and the `Found \d+ errors?` regex, yields the correct weighted signal on ANSI-stripped text; absence yields zero; markers split across stdout/stderr are detected per-stream.
- **Unit — confidence fusion (P1-T6):** command+output agree → high confidence; single weak signal → below `MIN_CONFIDENCE` → `unknown`. Pass: confidence always in `[0,1]`; boundary coercion verified (0.49 → `unknown`, 0.51 → category); fusion is deterministic and uses no external scorer.
- **Fixture — classification (P1-T9/T10):** every fixture classified to its labeled category. Pass: Vitest fixtures (plain, ANSI, default reporter, verbose reporter, ≥2 version variants, all-pass) → `vitest`; tsc fixtures → `typescript`; colored variants classify **identically** to plain variants; generic shell → `generic_shell`; empty → `unknown`.
- **Integration — pipeline order (P1-T7/T10):** drive a fake command output through the proxy path. Pass: (a) raw stored in content-store with ANSI intact and `rawContentId` returned **before** classify; (b) classify runs on ANSI-stripped text, never on raw bytes; (c) classify runs **before** any dispatch handler; (d) low-confidence routes to generic filter; (e) `MEGASAVER_OUTPUT_CLASSIFIER=off` bypasses to generic behavior with raw still stored/expandable; (f) exactly one raw copy exists (no double-store).
- **Integration — category enum closure:** assert the dispatch table has exactly four keys and the type guard rejects any v1.3 category name; guards against category leakage (spec sec 10.4).
- **e2e (smoke):** a real `vitest run` and a real `tsc --noEmit` (or recorded equivalents) through `proxy_run_command` with `MEGASAVER_DEBUG_CLASSIFIER=true`. Pass: audit shows correct category + confidence + signals fired; raw expandable via existing `proxy_expand_chunk` path; no savings/compression number is emitted (P1 emits none).

### Fixtures
Mandatory and detailed (spec sec 10.5). Each stored as raw bytes (ANSI preserved where applicable) plus a label asserting expected `category`:
- `vitest/plain-fail.txt` — plain (no ANSI) Vitest failing run with `FAIL`, `AssertionError`, `Test Files`, `Tests`, `Duration`, `Serialized Error`. Label: `vitest`.
- `vitest/ansi-fail.ansi` — same content with full ANSI color from default reporter. Label: `vitest`.
- `vitest/default-reporter.ansi` — Vitest default reporter output (spec sec 10.5). Label: `vitest`.
- `vitest/verbose-reporter.ansi` — Vitest verbose reporter output (spec sec 10.5). Label: `vitest`.
- `vitest/variant-v1.txt` and `vitest/variant-v2.txt` — ≥2 Vitest version/output variants to guard marker drift (spec sec 10.5). Label: `vitest`.
- `vitest/all-pass.txt` — passing run (no `FAIL`) confirming pass-runs still classify `vitest` via command + summary markers (`Test Files`, `Tests`, `Duration`). Label: `vitest`.
- `typescript/plain-errors.txt` — plain `tsc` output with `error TS`, `.ts(`, `Found N errors`. Label: `typescript`.
- `typescript/tsx-errors.txt` — output exercising the `.tsx(` marker. Label: `typescript`.
- `typescript/pretty-ansi.ansi` — ANSI-colored `tsc --pretty` output (spec sec 10.5). Label: `typescript`.
- `typescript/no-emit-clean.txt` — `tsc --noEmit` clean run (exit 0, near-empty output) testing command-signal-only classification. Label: `typescript`.
- `mixed/stdout-stderr.txt` — command producing both stdout and stderr with interleaved logs (spec sec 10.5). Label: per dominant signal (explicitly authored, e.g. `vitest`).
- `generic_shell/ls-la.txt` — recognizable shell output (`ls -la`) with no test/tsc markers. Label: `generic_shell` (asserts the distinct generic-shell category, not `unknown`).
- `unknown/ambiguous.txt` — output with a single weak/ambiguous marker and a non-matching command, designed to fall below `MIN_CONFIDENCE`. Label: `unknown` (asserts safe low-confidence fallback).
- `unknown/empty.txt` — empty/whitespace-only output. Label: `unknown`.

### Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Vitest/tsc reporter format drift breaks marker sniffing | Dual-signal design: command-match alone classifies even if output markers shift; ≥2 version-variant fixtures + default/verbose reporter fixtures pin known formats; markers centralized in one constants file. |
| ANSI strip corrupts payload (over-aggressive regex eats real text) | Idempotency + byte-equality unit tests; strip only recognized SGR/CSI/OSC + `\r`/`\b`/bell; never run on stored raw bytes. |
| Misclassification silently sends output to wrong (future) compressor | Confidence threshold + `unknown` fallback to generic filter; P2 compressors only invoked above threshold; debug/audit exposes category+confidence+signals for inspection. |
| Storing raw twice (duplicate of content-store) violates reuse guardrail | Reuse existing content-store API only; review asserts no new store module; integration test checks exactly one `rawContentId` per output. |
| Confidence fusion mistaken for / drifting into a second ranking engine | Fusion is a fixed-weight classifier heuristic documented as such; explicitly does not import or duplicate the context-pruner/LAMR scorer (guardrail 3); review checks no scoring-core import in P1. |
| Mixed stdout/stderr ambiguity (logs from one tool inside another's run) | Sniffer weights both streams and records `stream` per signal; dominant-signal wins; ambiguous → lower confidence → `unknown`/generic, never a wrong confident dispatch. |
| `generic_shell` and `unknown` collapsed into one bucket | They are distinct categories with separate fixtures (`generic_shell/ls-la.txt` vs `unknown/empty.txt`); enum-closure test asserts both exist and are reachable. |
| v1.3 category leaks into v1.2 enum | Closed `OutputCategory` union + build-time guard + enum-closure test reject any fifth value. |
| Classifier adds latency to every command | Pure single-pass string ops, early-exit on strong command match; e2e smoke confirms overhead negligible vs command runtime. |
| P1 over-claims savings it cannot produce | P1 emits no token-savings/compression number; savings are D7-core in P2. Honesty guardrail 5 upheld. |

### Exit Gate
Mapping **every** PR 2 / Deliverable 2 acceptance criterion (spec sec 10.6 — 7 criteria; sec 14-D2 — 7 criteria; sec 15-PR2 scope), de-duplicated:
- [ ] ANSI is stripped **before** classification (and before any compression). (sec 10.6, sec 14-D2, sec 15-PR2)
- [ ] Raw ANSI output remains stored in content-store and is available for expansion via `proxy_expand_chunk`. (sec 10.6)
- [ ] Classifier exists **before** compressor dispatch in the pipeline. (sec 10.6)
- [ ] Classifier returns a confidence value, and confidence is recorded. (sec 10.6, sec 14-D2)
- [ ] Low-confidence classification falls back safely to the generic output filter (sec 10.6 = sec 14-D2 "unknown output falls back safely"). (sec 10.6, sec 14-D2)
- [ ] Both command metadata and output sniffing are used as inputs. (sec 10.6)
- [ ] Classifier has fixture tests covering the full sec 10.5 corpus. (sec 10.6, sec 10.5)
- [ ] Vitest fixtures classified correctly (plain + reporters + variants + all-pass). (sec 14-D2)
- [ ] tsc fixtures classified correctly (plain + `.tsx(` + `--noEmit` command-only). (sec 14-D2)
- [ ] Colored (ANSI) output fixtures classified identically to their plain variants. (sec 14-D2)
- [ ] Classifier result (category, confidence, signals fired, rawContentId) appears in debug/audit mode. (sec 14-D2)
- [ ] v1.2 category set is exactly `vitest | typescript | generic_shell | unknown`, all four reachable, with `generic_shell` and `unknown` distinct, and no v1.3 category leaked. (sec 10.4, sec 14-D2)
- [ ] P1 ships **no** compressor and emits **no** token-savings/compression number (compressors + savings are P2). (sec 15-PR2 scope, sec 10.1)
- [ ] Cross-cutting: raw always stored + expandable; ANSI-normalized copy used only for classify/compress, never persisted over raw. (roadmap sec 10 guardrail 6)
- [ ] Cross-cutting: no new `packages/proxy`; content-store / output-filter / stats-audit reused, not forked; classifier is additive code inside output-filter. (guardrails 1, 3)
- [ ] Cross-cutting: confidence fusion is a fixed-weight classifier heuristic, not a second ranking engine; no context-pruner/LAMR scorer imported. (guardrail 3)
- [ ] Cross-cutting: no duplicate `proxy_*`/`mega_*` tool names and no MCP `tools/list` change introduced by this phase. (guardrail 2)
- [ ] Cross-cutting: no token-savings/interception claim made by P1; honesty preserved. (guardrail 5)

### Acceptance Scenarios
- **P1-AS1 (happy path — Vitest, ANSI):** *Given* `pnpm vitest run` produces ANSI-colored failing output, *When* it flows through `proxy_run_command`, *Then* raw bytes (with ANSI) are stored in content-store with a `rawContentId`, a copy is ANSI-stripped, and the classifier returns `vitest` with confidence above threshold; debug/audit shows category + confidence + signals fired. (Gate: ANSI-before-classify, raw stored/expandable, both inputs used, confidence recorded, audit visible.)
- **P1-AS2 (happy path — tsc, ANSI):** *Given* `tsc --pretty` emits colored `error TS2345` lines, *When* classified, *Then* category `typescript` with command + output signals both firing, classifying identically to the plain `tsc` fixture. (Gate: tsc fixtures, colored == plain.)
- **P1-AS3 (command-only signal):** *Given* `tsc --noEmit` exits 0 with near-empty output (no `error TS` markers), *When* classified, *Then* category `typescript` from the command signal alone, at a confidence reflecting single-source evidence. (Gate: both-inputs design; command signal sufficient.)
- **P1-AS4 (output-only signal):** *Given* a wrapper command (e.g. `make test`) whose name doesn't match patterns but whose output contains `Test Files`/`AssertionError`/`Serialized Error`, *When* classified, *Then* category `vitest` from output sniffing. (Gate: output sniffing as an input.)
- **P1-AS5 (low-confidence fallback):** *Given* output with one weak marker and a non-matching command, *When* fused confidence < `MEGASAVER_CLASSIFIER_MIN_CONFIDENCE`, *Then* category coerced to `unknown` and dispatch routes to the generic output filter — no compressor assumed. (Gate: low-confidence safe fallback.)
- **P1-AS6 (generic shell, distinct from unknown):** *Given* `ls -la` output with no test/tsc markers, *When* classified, *Then* `generic_shell` (the distinct non-empty shell category), routed to the generic filter — never a confident `vitest`/`typescript`. (Gate: four-category reachability; generic_shell ≠ unknown.)
- **P1-AS7 (mixed stdout/stderr):** *Given* a run with test summary on stdout and warnings on stderr, *When* classified, *Then* the dominant signal wins and category is correct; per-stream signals are recorded; ambiguity lowers confidence rather than forcing a wrong confident result. (Gate: both-inputs, mixed-stream fixture.)
- **P1-AS8 (flag disabled):** *Given* `MEGASAVER_OUTPUT_CLASSIFIER=off`, *When* a command runs, *Then* the classifier is bypassed, all output routes to the generic filter (pre-P1 behavior), and raw is still stored + expandable. (Gate: rollback path; raw-store invariant.)
- **P1-AS9 (empty output → unknown):** *Given* a command with empty/whitespace-only output, *When* classified, *Then* `unknown` with no confident category and generic fallback. (Gate: unknown reachability; no over-claim on empty input.)
- **P1-AS10 (raw expandable / no double-store):** *Given* any classified output, *When* the stored `rawContentId` is expanded via the existing `proxy_expand_chunk` path, *Then* the original ANSI bytes are returned intact and exactly one raw copy exists. (Gate: raw expandable; no duplicate store / no new store.)
- **P1-AS11 (debug off):** *Given* `MEGASAVER_DEBUG_CLASSIFIER=false`, *When* classification runs, *Then* the audit stream omits the verbose classifier record but category/confidence are still produced for downstream use. (Gate: debug/audit gating.)
- **P1-AS12 (category enum closure / no v1.3 leak):** *Given* the classifier and dispatch table, *When* inspected, *Then* exactly four categories exist, no `eslint`/`jest`/`playwright`/`next_build`/`git_*`/`build_log`/`generic_log` value is reachable, and the build fails on any fifth category. (Gate: v1.2 enum exactness, sec 10.4.)
- **P1-AS13 (no savings claim in P1):** *Given* any P1 classification, *When* the audit/debug record is read, *Then* it contains category/confidence/signals/rawContentId but **no** token-savings or compression-ratio number — those arrive with P2. (Gate: honesty; P1 ships no compressor/savings.)

*Note on adjacent edge cases out of P1 scope:* missing/stale-index handling belongs to P3 (`proxy_search_code`, spec sec 9.3); small-output passthrough and token-savings belong to P2 (spec sec 11, D7-core); missing-hook-log telemetry belongs to P5 (spec sec 13.6). P1 covers them only insofar as it must not break when those features are absent.

### Dependencies / Rollback / Estimate

**Dependencies.** Upstream: **P0 (Tool Naming Mode)** must land first so the classifier sits inside the canonical `proxy_run_command` path rather than a soon-to-be-renamed tool. Reuses existing content-store, output-filter, and stats/audit modules already present pre-v1.2. Downstream: **P2** (Vitest + TypeScript compressors + D7-core savings) consumes the category→handler dispatch table and the `ClassificationResult` shape — replacing the `vitest`/`typescript` generic-filter entries with real compressors and attaching savings numbers; **P4** ranking reads category as context (but does **not** reuse P1's fusion heuristic — it uses the shared scorer); **P6** replay trace references `category`, `confidence`, and `rawContentId`. P1 unblocks the compression critical path **P0 → P1 → P2 → P4 → P5**.

**Rollback / feature-flag plan.** `MEGASAVER_OUTPUT_CLASSIFIER=off` disables the classify stage and routes all command output straight to the generic output filter, reproducing pre-P1 behavior with no code revert — raw storage and expansion remain intact in both states. `MEGASAVER_CLASSIFIER_MIN_CONFIDENCE` can be raised toward 1.0 to make the classifier maximally conservative (nearly everything → `unknown` → generic) if a misclassification regression surfaces in the field. Because P1 adds no compressor, no savings claim, and no MCP schema change, disabling it is fully behavior-preserving and reversible per-install.

**Size estimate.** Medium — matches the spec's PR 2 estimate (sec 15-PR2). The ANSI normalizer and content-store/audit wiring are small and lean on existing modules; the real effort is the dual-signal classifier (command matcher + output sniffer + confidence fusion) and, especially, authoring a faithful fixture corpus capturing real ANSI from multiple Vitest reporters/versions and `tsc --pretty`. Risk concentrates in fixture fidelity and threshold tuning, not code volume — which is why the bulk of the work breakdown (P1-T4 through P1-T10) is sniffing logic and tests rather than plumbing.

---

## Phase P2 — Compression Core (Vitest + tsc) + Core Savings Metrics

### Objective
Ship the demo heart of Proxy Mode: a single `Compressor` interface with dispatch keyed on P1's classifier category, plus production Vitest and TypeScript compressors that turn noisy test/typecheck output into actionable, expandable summaries. Wire the small-output passthrough rule (1200/2000 token bands, spec 11.2) so tiny outputs are never over-wrapped into negative savings, and record per-call savings/passthrough/classifier/compressor metrics (D7-core, pulled forward per roadmap §1.1) **at compression time** so each compressor self-proves with real numbers. Everything reuses the existing content-store, stats/audit, and output-filter — P2 builds **no** parallel proxy stack, **no** second scorer, **no** second store, and **no** second ANSI/classify path (those are owned by P1 and consumed read-only here).

### In Scope
- A single `Compressor` interface contract and a dispatcher that maps the P1 category (`vitest` / `typescript` / `generic_shell` / `unknown`) plus confidence to a compressor.
- Vitest compressor (spec 14-D3): **keep** failing test names, assertion messages, stack traces, relevant file paths, line numbers, the `Test Files`/`Tests`/`Duration` summary, and exit code; **collapse** passing tests, repeated console logs, duplicate stack frames, long non-failing snapshots, and irrelevant warnings — each collapsed region registered as an expandable chunk ID.
- TypeScript (`tsc`) compressor (spec 14-D4): **keep** file path, line/column, `TS####` code, main message, grouped related errors, and top files by error count; **collapse** cascading-duplicate errors, huge generic type expansions, and exact-duplicate errors; preserve the `Found X errors` total and exit code.
- Small-output passthrough rule with three bands (`<1200` minimal passthrough, `1200–<2000` light summary + raw, `>=2000` full compression), configurable thresholds, and the exact minimal-passthrough text format from spec 11.3.
- D7-core metrics recorded **at compression time**, per response: raw tokens, returned tokens, saved %, passthrough count, classifier category count, compressor usage count — surfaced via `proxy_stats`.
- Reuse of: content-store (raw storage + expandable chunk IDs), P1's ANSI-normalization + classification output (consumed, never re-derived), stats/audit, and the existing output-filter generic path (the `unknown` / low-confidence fallback).
- Compression-specific golden fixtures for both compressors, consuming P1's classifier fixtures as raw inputs.

### Out of Scope
- All other compressors — ESLint, git diff, git status, Jest, Playwright, Next.js build, generic build/log — deferred to **v1.3** (spec 10.4 v1.3 categories; spec 17).
- Memory boost / failure-history boost / engine-aware ranking of which excerpts to keep — that is **P4 / Deliverable 6** behind `MEGASAVER_ENGINE_RANKING` (spec 8, 14-D6). P2 selection uses only the existing base relevance / output-filter ordering; **no second scorer** is created.
- Adoption rate, hook-based interception rate, and hook ingestion — **P5 / D7-rest, D8, D9** (spec 7, 13). P2 ships only the savings/passthrough/usage counters, never adoption or interception.
- `proxy_search_code` and any rg/index work — **P3 / Deliverable 5** (spec 9).
- Full replay-trace schema and offline-replay hardening — **P6 / Deliverable 10** (spec 12). P2 records D7-core counters and chooses field names compatible with P6, but does not own the trace schema.
- The classifier and ANSI-strip step themselves — owned by **P1 / Deliverable 2** (spec 10). P2 consumes the normalized output + classification result and **must not** re-implement ANSI stripping or output sniffing.
- Auto-budget, rich expand policies, naming-mode changes — **v1.3 / P0** respectively (spec 17; spec 5).

### Work Breakdown
| ID | Task | Detail | Size |
|---|---|---|---|
| P2-T1 | Define `Compressor` interface | Single TS interface: input = `{ classification, normalizedOutput, rawContentId, command, exitCode, filePath?, toolType, rawTokenEstimate }`; output = `CompressionResult` (compact text, kept/omitted chunk IDs, returnedTokenEstimate, compressorName, decision). Lives in evolved output-filter (`packages/output-filter/src/compress/` — illustrative, confirm in repo). | S |
| P2-T2 | Build compressor dispatcher | Keyed on P1 `classification.category` **and** `confidence`. `vitest`→Vitest compressor, `typescript`→tsc compressor, `generic_shell`/`unknown`/below-confidence-floor→existing output-filter generic path. Dispatch runs **only after** the passthrough gate (T6) selects the full-compression band. | S |
| P2-T3 | Vitest compressor | Parse P1's ANSI-normalized Vitest text. Keep: failing test names, assertion messages, stack traces, file paths, line numbers, `Test Files`/`Tests`/`Duration` summary, exit code. Collapse: passing tests (count only), repeated console logs (one + count), duplicate stack frames, non-failing snapshots, warnings. Register an expandable chunk ID per collapsed region. Defensive parse (marker-sniffing, not fixed columns); on parse failure return `undefined` so dispatcher falls back to generic. | L |
| P2-T4 | TypeScript compressor | Parse P1's ANSI-normalized `tsc` text. Keep: file path, line/col, `TS####` code, main message, grouped related errors, top-N files by error count. Collapse: cascading-duplicate errors (root kept), huge multi-line generic type expansions (head + chunk), exact-duplicate errors. Preserve `Found X errors` total + exit code. Register expandable chunk ID per collapsed group. Same defensive-parse + generic-fallback rule as T3. | L |
| P2-T5 | Raw-storage + expand wiring | Confirm raw stdout/stderr is already stored by P1 in content-store; compressor references that `rawContentId` for raw and registers collapsed-region chunk IDs resolvable by `proxy_expand_chunk` (P0). **No new store.** | M |
| P2-T6 | Small-output passthrough gate | Token-banded gate run **before** dispatch, keyed on `rawTokenEstimate`: `< passthrough_threshold`→minimal passthrough; `[passthrough, hard_wrap)`→light summary + raw; `>= hard_wrap`→full compression. Defaults 1200/2000, env-configurable. Enforce invariant `0 < passthrough_threshold <= hard_wrap_threshold` at config load (fail fast). | M |
| P2-T7 | Minimal/light passthrough formatters | Minimal band: emit the exact `MEGASAVER_PROXY_PASSTHROUGH` header block from spec 11.3 (raw token count + skip reason + raw output). Light band: one-line classifier+summary header, then full raw output; raw stays referenced by `rawContentId` so it remains expandable/auditable. | S |
| P2-T8 | D7-core metrics recorder | At compression time, per response, record: rawTokens, returnedTokens, savedPct (clamped `>=0`; `0` on any passthrough; `0` when `rawTokens==0`), passthrough count, per-category count (all four categories, including zero), per-compressor usage count. Write through existing stats/audit. **No** adoption/interception fields. | M |
| P2-T9 | Token estimator helper | Single deterministic token estimate used for **both** the threshold band decision and the savings %, so band and savings number always agree. Reuse the existing estimator if one exists (illustrative — confirm in repo); do not add a second estimator. | S |
| P2-T10 | `proxy_stats` surfacing | Extend the existing `proxy_stats` (P0) entry to expose D7-core aggregate fields. Adoption/interception fields remain **absent** until P5. | S |
| P2-T11 | Audit / debug visibility | Audit row per response carries: chosen compressor, decision (`passthrough_minimal`/`passthrough_light`/`compressed`), category, confidence (from P1), raw/returned tokens, saved %. Wording must not imply interception or adoption. | S |
| P2-T12 | Fixtures + golden outputs | Vitest + tsc compression golden fixtures (see Fixtures), snapshot-tested against expected compact output, including boundary token sizes and mixed stdout/stderr. | M |
| P2-T13 | Unit/integration/e2e tests | Per Test Strategy below. | M |

### Interfaces & Contracts

Env flags (new in P2; thresholds from spec 11.2):
```txt
MEGASAVER_PASSTHROUGH_THRESHOLD_TOKENS   # default 1200  (< → minimal passthrough)
MEGASAVER_HARD_WRAP_THRESHOLD_TOKENS     # default 2000  (>= → full compression)
# Invariant enforced at config load (fail fast): 0 < passthrough_threshold <= hard_wrap_threshold
```
No new MCP tool is added in P2 (naming is P0). `proxy_read_file` / `proxy_run_command` (P0) now route their command output through this pipeline; `proxy_expand_chunk` (P0) resolves the collapsed-region chunk IDs P2 registers; `proxy_stats` (P0) gains D7-core fields. No `proxy_*` and `mega_*` duplication is introduced — P2 adds no tools.

`Compressor` interface (illustrative path `packages/output-filter/src/compress/` — confirm in repo):
```ts
type OutputCategory = 'vitest' | 'typescript' | 'generic_shell' | 'unknown';

interface CompressorInput {
  classification: { category: OutputCategory; confidence: number };
  normalizedOutput: string;     // ANSI-stripped, produced by P1 — NOT re-derived here
  rawContentId: string;         // content-store ID of unchanged raw stdout/stderr (stored by P1)
  command: string;
  exitCode: number | null;
  filePath?: string;
  toolType: string;
  rawTokenEstimate: number;     // from shared estimator (P2-T9), same value used for savings %
}

interface CompressionResult {
  compact: string;              // returned compact output
  returnedTokenEstimate: number;
  keptChunkIds: string[];       // expandable via proxy_expand_chunk
  omittedChunkIds: string[];    // expandable via proxy_expand_chunk
  compressorName: 'vitest' | 'typescript' | 'generic' | 'passthrough';
  decision: 'passthrough_minimal' | 'passthrough_light' | 'compressed';
}

interface Compressor {
  name: CompressionResult['compressorName'];
  // returns undefined on parse failure → dispatcher falls back to generic path
  compress(input: CompressorInput): CompressionResult | undefined;
}
```

Pipeline boundary (P2 owns **only** the bracketed P2 steps; the rest is P1 and must not be re-implemented):
```txt
raw stdout/stderr → [store raw in content-store (P1)] → [strip ANSI (P1)] → [classify (P1)]
   → [P2: passthrough gate (keyed on shared rawTokenEstimate)]
        ├─ raw_tokens < 1200            → [P2: minimal passthrough]
        ├─ 1200 <= raw_tokens < 2000    → [P2: light summary + raw]
        └─ raw_tokens >= 2000           → [P2: dispatch → compressor | generic fallback] → compact
   → [P2: record D7-core metrics] → return
```

Minimal passthrough format (verbatim from spec 11.3):
```txt
MEGASAVER_PROXY_PASSTHROUGH

Output below compression threshold.
Raw tokens: 430
Compression skipped to avoid negative savings.

<raw output>
```

D7-core metrics record (appended to the existing audit row via stats/audit — **not** a new schema):
```json
{
  "rawTokens": 5120,
  "returnedTokens": 640,
  "savedPct": 87.5,
  "decision": "compressed",
  "category": "vitest",
  "compressor": "vitest",
  "passthrough": false
}
```
`proxy_stats` adds aggregate fields: `rawTokensTotal`, `returnedTokensTotal`, `savedPctAvg`, `passthroughCount`, `categoryCounts{vitest,typescript,generic_shell,unknown}` (all four keys always present, default 0), `compressorUsageCounts{vitest,typescript,generic,passthrough}`. Adoption/interception fields stay **omitted** until P5.

Savings rule (spec 11.4 — never a fake positive):
```txt
savedPct = (rawTokens <= 0) ? 0 : max(0, (rawTokens - returnedTokens) / rawTokens * 100)
On any passthrough decision (minimal or light), savedPct is recorded as 0  // wrapper may add bytes
```

### Module Touchpoints
- **output-filter** — host of `Compressor` interface, dispatcher, Vitest + tsc compressors, and the generic fallback path (`packages/output-filter` — illustrative, confirm in repo). Evolved, not forked.
- **content-store** — raw output already stored here by P1; P2 references the raw content ID and registers collapsed-region chunk IDs. Reuse, **no new store**.
- **stats/audit** — D7-core counters written here; `proxy_stats` entry extended. Reuse + extend.
- **Context Gate / Mega Saver Mode** — the existing compression entry point P2 plugs into; evolved, not rebuilt.
- **context-pruner / shared scorer (`packages/ranking-core`)** — **NOT modified in P2.** P2 uses only existing base relevance/output ordering. Shared-scorer extraction is P4.
- **policy layer / redaction pipeline** — unchanged; raw already passed through them upstream. P2 must not bypass them and adds nothing that re-handles secrets.

### Test Strategy
- **Unit — Vitest compressor:** feed P1-normalized fixtures; assert the full **keep** set present (failing names, assertion msgs, stack traces, file:line, `Test Files`/`Tests`/`Duration` summary, exit code) and the full **collapse** set absent from compact output (passing-test bodies, repeated logs reduced to one+count, duplicate stack frames, non-failing snapshots, warnings). Pass: golden snapshot match + `returnedTokens < rawTokens`.
- **Unit — tsc compressor:** assert each unique `TS####` with file:line:col + message kept, errors grouped by file, top-files-by-count section present, cascading duplicates collapsed (root kept), huge generic expansions collapsed to head + chunk, exact-duplicate errors collapsed, `Found X errors` + exit code preserved. Pass: golden snapshot match.
- **Unit — passthrough gate:** boundary tests at 1199/1200/1999/2000/2001 estimated tokens → correct band; custom env thresholds honored; invalid config (`passthrough > hard_wrap`, or `passthrough <= 0`) rejected at load. Pass: each input maps to expected `decision`; bad config throws.
- **Unit — metrics/savings:** `savedPct` math correct; `rawTokens==0` → `savedPct=0` (no divide-by-zero); passthrough (minimal **and** light) records `0` saved and increments `passthroughCount`; category/compressor counters increment correctly and report zero for unused categories. Pass: asserted counter deltas.
- **Integration — dispatch:** classifier category drives correct compressor; low-confidence/`unknown` → generic fallback (never Vitest/tsc). Pass: correct `compressorName` per category and confidence.
- **Integration — raw + expand:** after compression, `rawContentId` resolves to the original unchanged bytes; every collapsed region has a chunk ID resolvable by `proxy_expand_chunk`. Pass: round-trip raw == stored raw; all `omittedChunkIds` resolve. Also assert light-band raw stays referenced/expandable.
- **Integration — stats:** after N mixed responses, `proxy_stats` aggregates equal the sum of per-call records; adoption/interception fields absent; all four category keys present. Pass: aggregate equals sum of calls.
- **Integration — no re-derivation guardrail:** assert the compressor receives `normalizedOutput` + `rawContentId` from P1 and performs no ANSI stripping or re-classification of its own (e.g. mutation/spy test that P1's strip is the only strip). Pass: no second strip/store call.
- **e2e:** `proxy_run_command` running a real failing `vitest` and a real failing `tsc --noEmit` returns compressed output, exit code preserved, savings recorded, raw expandable. Pass: full pipeline green end-to-end.

### Fixtures
Compression-specific golden fixtures (consuming P1's classifier fixtures as raw inputs):
- **Vitest, failing-heavy** (plain + ANSI variant): mix of passing + several failing tests with `AssertionError`, stack traces, `Test Files`/`Tests`/`Duration` summary. Golden: compact keeps only failures + summary + exit code; duplicate stack frames collapsed.
- **Vitest, all-passing**: golden compact = summary line + pass count only, no per-test bodies; passing detail expandable.
- **Vitest, snapshot failure**: long snapshot diff on a **failing** test (kept) vs long snapshot on a **passing** test (collapsed).
- **Vitest, noisy console.log spam**: repeated identical log lines collapsed to one + count; warning lines collapsed.
- **Vitest, default reporter + verbose reporter** variants (and ≥2 version variants if available, per spec 10.5) → both compress to an equivalent kept set.
- **tsc, single-file many-errors** (plain + `tsc --pretty` ANSI): golden groups errors under the file, preserves each `TS####` + line:col.
- **tsc, cascading duplicates**: same root error echoed across dependents → collapsed, root kept, `Found X errors` preserved.
- **tsc, exact-duplicate errors** (non-cascading, identical error repeated) → collapsed to one + count, distinct from cascading case.
- **tsc, huge generic type expansion** (multi-line expanded type) → collapsed to head + expandable chunk.
- **tsc, multi-file top-N**: errors across many files → "top files by error count" section correct.
- **Boundary fixtures**: raw outputs estimated at ~430 (minimal passthrough), ~1500 (light summary + raw), ~2000 exactly (full-compression boundary `>=`), ~5000 (full compression) tokens.
- **generic_shell / unknown / low-confidence** output → routes to generic fallback, not Vitest/tsc.
- **mixed stdout/stderr** command output → classified + compressed without crossing stream boundaries incorrectly; raw round-trips intact.

### Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Reporter/version drift breaks Vitest parsing | Parse the ANSI-normalized text defensively (sniffed markers, not fixed columns); return `undefined` → generic fallback on parse failure; ≥2 reporter + version fixtures per spec 10.5. |
| Compression drops actionable failure detail | Golden tests assert every failing name / assertion / stack trace / TS code / file:line is retained; omitted regions always expandable via chunk IDs — nothing is unrecoverable. |
| Wrapper makes small outputs cost more (negative savings) | Passthrough bands (1200/2000); passthrough records `0` saved, never fake-positive; boundary tests at thresholds (spec 11.4). |
| Token estimate for threshold differs from one used for savings | Single shared estimator (P2-T9) feeds both gate and metrics — guaranteed agreement. |
| Accidentally building a second selection/ranking engine | P2 uses only existing base relevance/output-filter ordering; memory/failure boosts and shared-scorer extraction are P4 — enforced in review (guardrail §3, spec 8). |
| Re-stripping ANSI or re-storing raw (duplication) | P2 consumes P1's `normalizedOutput` + existing `rawContentId` only; no ANSI logic, no new store — guardrail check + no-re-derivation integration test. |
| Low-confidence classification mis-routed to a specialized compressor | Dispatcher sends low-confidence/`unknown` to generic fallback; integration test asserts it. |
| `rawTokens==0` / empty output divide-by-zero in savings | Savings rule clamps to `0` when `rawTokens<=0`; unit test covers it. |
| Audit wording overclaims interception/adoption | Audit/debug fields limited to compressor/decision/category/confidence/tokens/saved%; no adoption/interception language — guardrail §5. |

### Exit Gate
Maps every acceptance criterion for PR 3 / Deliverable 3 (Vitest), Deliverable 4 (tsc), the Small-Output Passthrough rule (spec 11), and D7-core (spec 14-D7 universal-savings subset pulled forward per roadmap §1.1).

Deliverable 3 — Vitest compressor (spec 14-D3):
- [ ] Raw Vitest output stored in content-store (reused from P1, not re-stored by P2).
- [ ] ANSI-normalized output used for compression (consumed from P1, not re-stripped).
- [ ] Compressed output keeps actionable failure detail: failing test names, assertion messages, stack traces, relevant file paths, line numbers, and the `Test Files`/`Tests`/`Duration` summary.
- [ ] Collapse list applied: passing tests, repeated logs, duplicate stack frames, long non-failing snapshots, irrelevant warnings.
- [ ] Exit code preserved.
- [ ] Expandable chunks available for every collapsed region.
- [ ] Token savings measured for Vitest responses.
- [ ] Small Vitest outputs passthrough (not over-wrapped).

Deliverable 4 — TypeScript compressor (spec 14-D4):
- [ ] Raw tsc output stored (reused content-store, not re-stored).
- [ ] ANSI-normalized output used for compression (consumed from P1).
- [ ] Grouped compiler errors returned: grouped by file, each `TS####` with file path + line/column + main message, grouped related errors, top files by error count.
- [ ] Collapse list applied: cascading-duplicate errors, huge generic type expansions, exact duplicates; `Found X errors` total preserved.
- [ ] Full output expandable.
- [ ] Exit code preserved.
- [ ] Token savings measured for tsc responses.
- [ ] Small tsc outputs passthrough.

Small-output passthrough rule (spec 11):
- [ ] Small outputs are not over-wrapped (`<1200` → exact minimal-passthrough format from spec 11.3, including `Raw tokens: N` line).
- [ ] Middle band (`1200–<2000`) returns light summary + raw output (not full compression); raw stays expandable.
- [ ] Full-compression band (`>=2000`) runs compression; `>=` boundary verified at exactly 2000.
- [ ] Audit records `passthrough`.
- [ ] Token savings does not report fake-positive savings on passthrough (recorded as 0).
- [ ] User can configure thresholds (env flags for 1200/2000); invalid config (`passthrough > hard_wrap` or `<= 0`) rejected at load.

D7-core metrics pulled forward (spec 14-D7 universal subset; roadmap §1.1 / §5):
- [ ] Per-call raw tokens, returned tokens, saved % recorded at compression time (saved % clamped `>=0`, safe at `rawTokens==0`).
- [ ] Passthrough count recorded.
- [ ] Classifier category count recorded (all four categories, zero-safe).
- [ ] Compressor usage count recorded.
- [ ] These metrics visible in `proxy_stats`.
- [ ] Adoption rate and hook-based interception are NOT introduced here (remain P5); audit wording does not overclaim.

Cross-cutting guardrails (roadmap §10 — merge blockers):
- [ ] No parallel proxy stack / new `packages/proxy`; compressors live in evolved output-filter.
- [ ] No new `proxy_*`/`mega_*` tool names added; P2 adds zero MCP tools.
- [ ] Raw always stored + expandable; ANSI-normalized used only for classify/compress; P2 does **not** re-strip ANSI, re-classify, or re-store raw.
- [ ] Reuses content-store, stats/audit, output-filter; no second store, no second estimator, no second ranking engine.

### Acceptance Scenarios
- **P2-AS1 (happy — Vitest):** Given a 5000-token failing Vitest run classified `vitest` with high confidence, When `proxy_run_command` returns, Then output is compressed keeping all failing test names/assertions/stack traces + `Test Files`/`Tests`/`Duration` summary + exit code, raw is expandable, and `proxy_stats` shows raw=5000 / returned≪5000 / saved%>0.
- **P2-AS2 (happy — tsc):** Given a multi-file failing `tsc --noEmit` (>2000 tokens) classified `typescript`, When returned, Then errors are grouped by file with a top-files-by-count section, each `TS####`+file:line:col preserved, `Found X errors` + exit code preserved, full output expandable, savings recorded.
- **P2-AS3 (minimal passthrough):** Given raw output of ~430 tokens, When processed, Then the exact `MEGASAVER_PROXY_PASSTHROUGH` block (spec 11.3) with `Raw tokens: 430` + raw output is returned, audit records `passthrough`, and savings is recorded as 0 (no fake positive).
- **P2-AS4 (light-summary band):** Given raw output of ~1500 tokens (1200–<2000), When processed, Then a light summary header + full raw output is returned (not full compression), decision = `passthrough_light`, savings recorded as 0, and the raw remains expandable via `rawContentId`.
- **P2-AS5 (full-compression boundary):** Given raw output of exactly 2000 tokens, When processed, Then the full-compression path runs (boundary `>=2000`), not the light band.
- **P2-AS6 (low-confidence fallback):** Given Vitest-looking output classified with low confidence (or `unknown`), When dispatched, Then the generic output-filter path is used — not the Vitest/tsc compressor — and the category count increments under the actual classified category.
- **P2-AS7 (all-passing Vitest):** Given an all-passing Vitest run, When compressed, Then output collapses to summary + pass count only with no per-test bodies, and all passing-test detail is expandable.
- **P2-AS8 (cascading tsc duplicates):** Given one root type error echoed across many dependent files, When compressed, Then cascading duplicates collapse to the root error + expandable chunk, and `Found X errors` total is preserved.
- **P2-AS9 (exact-duplicate tsc errors):** Given an identical error repeated verbatim (non-cascading), When compressed, Then duplicates collapse to one occurrence + count, distinct from the cascading case, with the duplicates expandable.
- **P2-AS10 (huge generic expansion):** Given a tsc error with a multi-line expanded generic type, When compressed, Then the expansion collapses to a head line + expandable chunk, with the `TS####` + file:line:col kept.
- **P2-AS11 (configured threshold):** Given `MEGASAVER_PASSTHROUGH_THRESHOLD_TOKENS=300`, When a 430-token output is processed, Then it now takes the light/compression path (threshold honored); and given `passthrough > hard_wrap`, config load fails fast.
- **P2-AS12 (expand round-trip):** Given a compressed response with omitted chunk IDs, When `proxy_expand_chunk` is called on each, Then every collapsed region resolves and the full raw is reconstructable from the stored `rawContentId` (round-trip raw == stored raw).
- **P2-AS13 (parser failure safety):** Given a Vitest/tsc variant the parser cannot handle, When compressed, Then the compressor returns `undefined`, the dispatcher falls back to the generic path (no crash), and raw stays stored + expandable.
- **P2-AS14 (mixed stdout/stderr):** Given a command emitting both stdout and stderr, When classified and compressed, Then stream boundaries are not crossed incorrectly and the raw round-trips intact through `rawContentId`.
- **P2-AS15 (no re-derivation):** Given P2 processing, When inspected, Then no second ANSI strip, no re-classification, and no second raw store occurs — P2 consumes P1's `normalizedOutput`, `classification`, and `rawContentId` only.
- **P2-AS16 (no adoption/interception leakage):** Given `proxy_stats` after P2-only work, When inspected, Then it shows savings/passthrough/category/compressor counts (all four category keys present) but NO adoption rate or hook-based interception (those are P5), and no missing-hook claim is overstated.

### Dependencies / Rollback / Estimate
**Upstream/downstream deps.** Hard upstream: P1 (classifier + ANSI strip + raw-in-content-store) and P0 (`proxy_*` tool names, `proxy_stats`, `proxy_expand_chunk`). P2 cannot start until P1's `normalizedOutput` + `classification` contract is stable. Downstream: P4 ranking upgrades excerpt-selection inside these compressors (consuming the same `Compressor` interface — no second scorer); P6 replay trace records the same raw/returned token estimates and compressor/decision fields P2 emits, so P2's metric field names are chosen to be P6-compatible. P2 must not depend on P3 (search) or P4 (ranking).

**Rollback / feature-flag plan.** Passthrough thresholds are env-driven (`MEGASAVER_PASSTHROUGH_THRESHOLD_TOKENS`, `MEGASAVER_HARD_WRAP_THRESHOLD_TOKENS`); setting the passthrough threshold above any realistic output size effectively forces passthrough and disables compression with no code change. The dispatcher's generic fallback is the safe default for every category, so disabling a single compressor degrades gracefully to generic output-filter behavior. Because raw is always stored and the compressors only change the *returned* view, rollback never loses data — reverting P2 leaves P0/P1 fully functional (classify-only, no compression). No DB migration; D7-core counters append to the existing audit row, so removing them is non-destructive.

**Size estimate.** Medium–Large, matching spec PR 3 ("medium-large") and roadmap P2 (M–L). The two parsers (Vitest reporter variants; tsc grouping + cascade/duplicate/generic-expansion collapse) are the bulk of the effort and the main risk; the interface, dispatcher, passthrough gate, and D7-core counters are each small because they reuse content-store, stats/audit, and output-filter. Fixture/golden-test breadth (multiple reporters + ANSI + boundary token sizes + mixed streams) pushes this from M to M–L.

---

## Phase P3 — proxy_search_code

### Objective
Ship `proxy_search_code` as a new MCP tool whose source of truth is policy-gated live `rg` execution over the current filesystem; the semantic index is optional enrichment only and a missing or stale index never blocks search (spec sec 9.2, 9.3). Raw search output is always stored verbatim in content-store and remains expandable, while returned results are grouped by file, ranked, compressed, and annotated with per-file reasons (spec sec 14-D5). This phase delivers a genuinely new, high-value search-output savings capability by **evolving** the existing command-policy, content-store, redaction, ranking, and stats infrastructure — never forking it (guardrails §10.1, §10.3).

### In Scope
- New MCP tool `proxy_search_code` registered behind the P0 naming mode (proxy-only by default; new tool, **no `mega_*` twin** listed in either mode — guardrail §10.2).
- rg-first backend: policy-gated `rg` invocation over the resolved `path_scope` as the authoritative result set (spec sec 9.2 step 1).
- Raw rg stdout **and** stderr stored unchanged in content-store with expandable chunk IDs (reuse `proxy_expand_chunk` / `mega_fetch_chunk` — spec sec 9.2 step 2, guardrail §10.6).
- ANSI normalization of rg output for grouping/classification/compression only; the stored raw retains original ANSI verbatim (guardrail §10.6; spec sec 10.2 pipeline).
- Group-by-file aggregation of matches (spec sec 9.2 step 3); per-file relevance ranking via the shared scorer adapter, degrading to base output relevance until P4 lands (spec sec 9.2 step 4, sec 8).
- Compression of noisy/low-value matches within budget; per-file `reason`; explicit `omitted` list with counts and expandable chunk IDs (spec sec 9.2 step 4, sec 14-D5 output).
- Optional index enrichment (block names, related symbols, related tests) gated on index presence + freshness; never overriding live matches; clearly marked `index_enrichment` status in output **and** audit (spec sec 9.2 step 5, sec 9.5).
- Stale/missing index handling emitting status (`available` / `unavailable` / `skipped_stale_index`) and an optional `mega index build` suggestion — never an error (spec sec 9.3).
- Reuse of the existing command policy/allowlist to gate search execution: the `rg` binary itself, `path_scope`, glob filters, and any flag derived from inputs (spec sec 9.5 "respects existing command policy", guardrail §10.3).
- Reuse of the existing redaction pipeline on **both** stored raw chunks and returned snippets (guardrail §10.6 raw-stored; spec sec 12.3 privacy posture).
- D7-core savings/usage metrics for search responses (raw tokens, returned tokens, saved %, passthrough count, per-tool usage count) emitted to stats/audit at compression time and surfaced via `proxy_stats` (roadmap §1.1 D7-core, spec sec 14-D5 "metrics recorded").
- Small-output passthrough applied to search responses, reusing the P2 thresholds and minimal-passthrough contract (spec sec 11, sec 14-D5 cross-ref to passthrough).
- Connector-facing MCP tool description biasing agents to prefer `proxy_search_code` over native grep/search (spec sec 6).

### Out of Scope
- `search_backend=rg|index|hybrid` selector and index-first/hybrid search modes — explicitly deferred to **v1.3** (spec sec 9.4; roadmap §6 "Defer to v1.3").
- Index-first ranking, repo-index signal, dependency-support signal, recent-edit signal, rule efficacy, full LAMR multi-signal scoring — **v1.3** (spec sec 8.3, sec 17). P3 consumes only base output relevance plus, once P4 merges, memory/failure-history boosts via the shared scorer.
- The shared-scorer extraction itself — owned by **P4** (PR 5 / D6). P3 calls the scorer through a thin adapter and degrades gracefully when `MEGASAVER_ENGINE_RANKING` is off or the scorer is absent (spec sec 8.2; roadmap §7).
- Replay-trace schema hardening / expand-event linking — owned by **P6** (PR 7 / D10). P3 emits only the search-specific fields the existing trace writer already accepts (spec sec 12; roadmap §9).
- Building or maintaining the index, and the `mega index build` command itself — pre-existing; P3 only reads index freshness and **suggests** the command (spec sec 9.3).
- Additional compressor categories beyond search output (ESLint, git diff, Next.js build, Jest, Playwright) — **v1.3** (spec sec 10.4, sec 17).
- Hook-based interception metrics and adoption rate — **P5** (D7-rest; spec sec 7, sec 13).

### Work Breakdown

| ID | Task | Detail | Size |
|---|---|---|---|
| P3-T1 | Implement `proxy_search_code` tool handler | Replace the P0-registered stub with a real handler in the MCP tool layer (illustrative: `packages/context-gate/tools` — confirm in repo). Orchestrate the validate→policy→rg→store→ANSI-strip→group→rank→compress→enrich flow. No new exec or storage path. | M |
| P3-T2 | Input schema + defaults + validation | JSON Schema for `query, task, path_scope, max_results, max_tokens, include_globs, exclude_globs, context_lines`; defaults; reject empty/whitespace-only `query`; clamp numeric bounds; reject non-array globs. Validation runs **before** any exec. | S |
| P3-T3 | Policy-gated rg execution | Build rg argv from validated inputs and run it through the existing command-execution wrapper + allowlist (Context Gate policy layer). The `rg` binary, `path_scope`, every glob, and every flag pass the allowlist; denial returns a policy error with **no** subprocess spawned. Map `include_globs`/`exclude_globs`/`path_scope`/`context_lines` to rg flags. | M |
| P3-T4 | Raw output storage | Store raw rg stdout **and** stderr unchanged in content-store; obtain chunk IDs; run the existing redaction pipeline on stored content before it is persisted and on returned snippets. | S |
| P3-T5 | ANSI normalization for processing | Reuse the P1 output-filter ANSI-strip step on rg output before grouping/classification/compression; never strip the stored raw (guardrail §10.6). | S |
| P3-T6 | Group-by-file aggregation | Parse rg output into a per-file structure (path, match lines, line/col, surrounding context). Prefer `rg --json` event stream; fall back to `--vimgrep` (`--with-filename --line-number --column`). Unparseable lines are preserved as raw passthrough, never silently dropped. | M |
| P3-T7 | Rank matches via shared-scorer adapter | Call the shared ranking service (P4) for per-file/per-match scores; if `MEGASAVER_ENGINE_RANKING` off or scorer absent, fall back to the **existing** base output relevance (BM25/output match) — no second ranking engine, no new formula (guardrail §10.3; spec sec 8). | M |
| P3-T8 | Compress + omit low-value matches | Within `max_results`/`max_tokens` budget select top files/snippets, collapse noisy/duplicate matches, attach per-file `reason`, list `omitted` with file/match counts and expandable chunk IDs. | M |
| P3-T9 | Index freshness probe + enrichment | Detect index presence + staleness (mtime/hash vs working tree, window = `MEGASAVER_SEARCH_INDEX_STALE_SECONDS`); when fresh, annotate **only files already in the live result set** with block names, related symbols, related tests; never inject or reorder by enrichment. Set `index_enrichment.status`. | M |
| P3-T10 | Stale/missing/error index handling | Emit `index_enrichment.status = available | unavailable | skipped_stale_index`; on stale/missing/probe-failure add optional `mega index build` suggestion; any probe exception is caught and treated as `unavailable` — search always returns (spec sec 9.3). | S |
| P3-T11 | Small-output passthrough for search | Apply P2 thresholds to `raw_tokens`; minimal/light/full modes; audit records `passthrough`; `saved_pct` never falsely positive on passthrough (spec sec 11.4). | S |
| P3-T12 | D7-core metrics for search | Emit raw tokens, returned tokens, saved %, passthrough count, and `proxy_search_code` usage count to stats/audit; surfaced via `proxy_stats`. | S |
| P3-T13 | Audit + index-enrichment marking | Per-call audit entry: query, policy decision, classifier/enrichment status, savings; enrichment used/skipped marked explicitly (spec sec 9.5 "marked in output/audit"). | S |
| P3-T14 | Replay-trace fields (search) | Emit search-specific trace fields (query, candidate/selected/omitted excerpts, signal values, final scores, ranking-mode flags, passthrough/compressed decision) to the **existing** trace writer, referencing content-store IDs only. Full schema hardening is P6 (spec sec 12.3). | S |
| P3-T15 | MCP tool description / connector wording | Agent-friendly description biasing toward `proxy_search_code` over native grep/search; instructs "expand chunks before assuming omitted content irrelevant" (spec sec 6, sec 8 of D8 principle). | S |
| P3-T16 | Tests + fixtures | Unit, integration, fixture, and e2e tests per Test Strategy below. | L |

### Interfaces & Contracts

Environment flags (consumed, not introduced unless marked NEW):
```txt
MEGASAVER_TOOL_NAMING=proxy|legacy        # P0; proxy_search_code listed only, no mega_* twin in either mode
MEGASAVER_ENGINE_RANKING=true|false       # P4; when false/absent, P3 uses base output relevance only
MEGASAVER_PASSTHROUGH_THRESHOLD_TOKENS    # reuse P2 default 1200
MEGASAVER_HARD_WRAP_THRESHOLD_TOKENS      # reuse P2 default 2000
MEGASAVER_SEARCH_INDEX_STALE_SECONDS      # NEW (P3) staleness window for enrichment probe; default illustrative 86400 — confirm in repo
```

MCP tool signature:
```txt
tool: proxy_search_code   (new tool; no mega_* twin — not listed in legacy mode either, per P0 mapping spec sec 5.3)
```

Input JSON Schema:
```json
{
  "type": "object",
  "required": ["query"],
  "additionalProperties": false,
  "properties": {
    "query":        { "type": "string", "minLength": 1, "description": "rg pattern (regex by default). Whitespace-only rejected." },
    "task":         { "type": "string", "description": "Optional task text used for task-aware ranking when MEGASAVER_ENGINE_RANKING is on." },
    "path_scope":   { "type": "string", "default": ".", "description": "Root path to search; must pass command policy/allowlist." },
    "max_results":  { "type": "integer", "minimum": 1, "maximum": 500, "default": 50 },
    "max_tokens":   { "type": "integer", "minimum": 200, "maximum": 20000, "default": 4000 },
    "include_globs":{ "type": "array", "items": { "type": "string" }, "default": [] },
    "exclude_globs":{ "type": "array", "items": { "type": "string" }, "default": [] },
    "context_lines":{ "type": "integer", "minimum": 0, "maximum": 20, "default": 2 }
  }
}
```

Output JSON Schema (compressed response):
```json
{
  "type": "object",
  "required": ["mode", "query", "files", "omitted", "index_enrichment", "metrics", "raw_chunk_id"],
  "properties": {
    "mode":  { "enum": ["compressed", "passthrough_light", "passthrough_minimal"] },
    "query": { "type": "string" },
    "task":  { "type": "string" },
    "ranking_mode": { "enum": ["engine", "base_relevance"], "description": "engine = shared scorer with memory/failure boosts (P4 on); base_relevance = fallback. Honest: no engine claim when flag off." },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "match_count", "snippets", "reason", "raw_chunk_id"],
        "properties": {
          "path":        { "type": "string" },
          "match_count": { "type": "integer" },
          "score":       { "type": "number", "minimum": 0, "maximum": 1 },
          "reason":      { "type": "string", "description": "Why this file was included (ranking signals when engine on; match density when base)." },
          "snippets": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["line", "text"],
              "properties": {
                "line":   { "type": "integer" },
                "col":    { "type": "integer" },
                "text":   { "type": "string", "description": "ANSI-stripped, redacted." }
              }
            }
          },
          "enrichment": {
            "type": "object",
            "description": "Present only when index_enrichment.status == available, and only for files already in the live result set.",
            "properties": {
              "block_names":     { "type": "array", "items": { "type": "string" } },
              "related_symbols": { "type": "array", "items": { "type": "string" } },
              "related_tests":   { "type": "array", "items": { "type": "string" } }
            }
          },
          "raw_chunk_id": { "type": "string", "description": "content-store ID for this file's full raw matches (verbatim, original ANSI)." }
        }
      }
    },
    "omitted": {
      "type": "object",
      "required": ["file_count", "match_count", "expand_chunk_ids"],
      "properties": {
        "file_count":       { "type": "integer" },
        "match_count":      { "type": "integer" },
        "expand_chunk_ids": { "type": "array", "items": { "type": "string" } }
      }
    },
    "index_enrichment": {
      "type": "object",
      "required": ["status"],
      "properties": {
        "status":     { "enum": ["available", "unavailable", "skipped_stale_index"] },
        "suggestion": { "type": "string", "description": "e.g. 'Run: mega index build' (only when unavailable/skipped_stale_index)." }
      }
    },
    "metrics": {
      "type": "object",
      "required": ["raw_tokens", "returned_tokens", "saved_pct"],
      "properties": {
        "raw_tokens":      { "type": "integer" },
        "returned_tokens": { "type": "integer" },
        "saved_pct":       { "type": "number" },
        "passthrough":     { "type": "boolean" }
      }
    },
    "raw_chunk_id": { "type": "string", "description": "content-store ID for the full raw rg output (stdout+stderr, original ANSI)." }
  }
}
```

Minimal passthrough format (raw_tokens < threshold — reuses the P2 contract, spec sec 11.3):
```txt
MEGASAVER_PROXY_PASSTHROUGH

Output below compression threshold.
Raw tokens: <n>
Compression skipped to avoid negative savings.

<raw rg output>
```

Function/service boundaries (illustrative paths — confirm in repo):
```txt
search backend invocation  → policy layer / command-execution wrapper (existing) — NOT a new exec path
ANSI normalization         → output-filter ANSI-strip step (P1, existing)
raw storage + expansion    → content-store + proxy_expand_chunk/mega_fetch_chunk (existing)
redaction                  → redaction pipeline (existing) — applied on store AND return
ranking                    → shared ranking service (packages/ranking-core, owned by P4) via thin adapter
metrics/audit              → stats/audit (existing) — D7-core fields
replay trace               → existing trace writer (full schema in P6), content-store IDs only
index probe + enrichment   → existing index/retrieval module (read-only)
```

### Module Touchpoints
- **Context Gate** — orchestration entry point for the new tool; reuses its policy/exec path; not rebuilt (guardrail §10.1).
- **policy layer / command allowlist** (illustrative: `packages/context-gate/policy` — confirm in repo) — gates the rg binary, path scope, glob filters, and derived flags.
- **output-filter** — ANSI normalization step and generic-filter fallback for low-value match collapse.
- **content-store** — raw rg stdout+stderr storage and expandable chunk IDs.
- **redaction pipeline** — secret redaction on stored raw and returned snippets (both paths).
- **context-pruner / shared ranking service** (illustrative: `packages/ranking-core` or `packages/context-pruner/scoring` — confirm in repo) — per-file/per-match scoring via adapter; not duplicated (guardrail §10.3).
- **stats/audit** — D7-core search metrics and per-call audit entry with `index_enrichment` marking.
- **index / retrieval module** (existing, read-only) — freshness probe and enrichment data.
- **MCP tool registry / naming adapter** (P0) — `proxy_search_code` listing and description.
- **replay trace writer** (P6-owned schema) — search-specific fields only in this phase.

### Test Strategy
- **Unit:**
  - Input validation: empty/whitespace `query` rejected; numeric bounds clamped; defaults applied; non-array globs rejected. Pass: invalid inputs error before any exec; valid inputs produce expected rg argv.
  - rg argv builder: `include_globs`/`exclude_globs`/`path_scope`/`context_lines` map to correct rg flags; `context_lines=0` emits no context flag; empty glob arrays add no `-g`. Pass: argv matches expected for each combination.
  - Group-by-file parser: rg `--json` and `--vimgrep` lines → correct per-file structure with line/col/context; malformed line preserved as raw passthrough, never dropped. Pass: parsed tree equals expected for fixtures; corrupt-line fixture loses no match.
  - Index freshness probe: fresh → `available`; absent → `unavailable`; stale → `skipped_stale_index`; probe throws → `unavailable` (caught). Pass: status correct for each fixture state including the exception case.
  - Passthrough thresholds for search: <1200 minimal, 1200–2000 light, ≥2000 full. Pass: mode selected per threshold; audit records `passthrough`; `saved_pct` not falsely positive on passthrough.
  - Ranking fallback: scorer absent / flag off → base output relevance ordering, `ranking_mode=base_relevance`, no crash, no second-scorer instantiated. Pass: deterministic base ordering; output honestly labels base mode.
  - Zero matches: rg exit code for no-match → clean empty `files`, `omitted` zeros, metrics present, no error.
- **Integration:**
  - End-to-end handler over a temp repo with rg installed: rg runs through the policy wrapper, raw stored, grouped, compressed, metrics emitted. Pass: response validates against output schema; `raw_chunk_id` resolvable via expand.
  - Policy enforcement: out-of-allowlist `path_scope`, disallowed glob, or disallowed flag rejected by the existing policy. Pass: policy denial surfaces, **no** rg subprocess runs.
  - Redaction (both paths): a planted secret in a matched line is redacted in the returned snippet **and** in the stored chunk. Pass: secret absent from output and from stored content.
  - Enrichment never overrides live matches: index lists a file rg did not match → that file never appears in `files`, and enrichment never reorders live results. Pass: live result set and order unchanged; enrichment only annotates present files.
  - Metrics: D7-core fields present and consistent (`returned_tokens ≤ raw_tokens`, `saved_pct` computed). Pass: `proxy_stats` reflects the call and increments `proxy_search_code` usage.
- **Fixture:**
  - rg fixtures (plain + ANSI-colored, `--json` and `--vimgrep` formats), large noisy output, zero-match output, malformed/partial line. Pass: classification/grouping/compression deterministic; ANSI never leaks into processed output but raw chunk retains it.
- **E2E (MCP):**
  - `tools/list` in proxy mode lists `proxy_search_code` exactly once, no `mega_*` twin; description biases toward proxy. Pass: single entry, schema valid.
  - `tools/list` in legacy mode: `proxy_search_code` is a new tool with no legacy twin and is not duplicated. Pass: no duplicate/paired listing (guardrail §10.2).
  - Full agent round-trip: search → compressed response → `proxy_expand_chunk` on an omitted chunk → full verbatim raw including original ANSI. Pass: expansion returns raw unchanged.
  - Missing-index e2e: search with no index returns results + `index_enrichment.status = unavailable` + suggestion, exit success. Pass: no error, status correct.
  - Stale-index e2e: files edited after indexing → results + `status = skipped_stale_index` + suggestion; live matches unchanged. Pass: no error, live results identical to no-index run.

### Fixtures
Test data / fakes needed for P3 (P1/P2 ANSI and passthrough fixtures exist upstream; P3 adds search-specific data):
- `fixtures/search/repo-small/` — small synthetic repo (`.ts`/`.tsx`/`.md` files) with known match positions for deterministic grouping/ranking assertions.
- `fixtures/search/rg-plain.txt` — plain `rg --vimgrep` output, multiple files, multiple matches per file.
- `fixtures/search/rg-json.jsonl` — `rg --json` event stream for the same repo (parser fixture).
- `fixtures/search/rg-ansi.txt` — ANSI-colored rg output (color forced on) to assert strip-before-process and raw retention.
- `fixtures/search/rg-malformed.txt` — a truncated/corrupt rg line to assert unparseable-line raw passthrough (no dropped match).
- `fixtures/search/rg-noisy-large.txt` — large output (>2000 tokens) with many low-value/duplicate matches to exercise compression + omission + expand IDs.
- `fixtures/search/rg-small.txt` — small output (<1200 tokens) to exercise minimal passthrough.
- `fixtures/search/rg-zero-matches.txt` — empty result to assert clean "no matches" response and metrics.
- `fixtures/search/secret-line.txt` — a match line containing a planted credential to assert redaction on store + return.
- `fixtures/index/fresh/`, `fixtures/index/stale/`, `fixtures/index/absent/` — three index states (fresh metadata, stale mtime/hash, no index) for the enrichment-status matrix.
- `fixtures/index/enrichment.json` — block names / related symbols / related tests for files in `repo-small` (annotation assertions), **including** one file not matched by rg to assert enrichment-only files never surface.
- Fakes/stubs: command-policy stub allowing/denying specific `path_scope`/globs/flags; shared-scorer fake returning fixed scores plus an "absent scorer" mode to test ranking fallback independent of P4; index-probe fake with a throwing mode to test the caught-exception path.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| rg output parsing brittle across versions/locales | Prefer `rg --json`; fall back to `--vimgrep`; pin parser against multiple fixture variants; treat unparseable lines as raw passthrough, never drop matches silently. |
| Index enrichment silently overrides or contradicts live rg results | Enrichment only annotates files already in the live set and never reorders; unit + integration tests assert no enrichment-only file appears and live order is unchanged; live results are source of truth (spec sec 9.5). |
| Stale/missing/erroring index blocks or errors the search | Index probe is best-effort and non-fatal; any failure (absent/stale/exception) returns live results with the correct `index_enrichment.status`; covered by missing-index, stale-index, and throwing-probe tests (spec sec 9.3). |
| Search exec bypasses command policy (new exec path) | Route rg exclusively through the existing command-execution wrapper + allowlist; binary/path/globs/flags all checked; integration test asserts denial with no subprocess; no direct subprocess in the handler (guardrail §10.3). |
| Duplicate ranking logic creeps into search | P3 calls only the shared scorer adapter; base-relevance fallback is the *existing* output match, not a new formula; `ranking_mode` is reported honestly; code-review guardrail + test asserts no second scorer instantiated (guardrail §10.3). |
| Dishonest "task relevance" claim when ranking flag is off | `ranking_mode` field distinguishes `engine` vs `base_relevance`; when the flag is off `task` does not feed memory/failure boosts and the response does not claim engine ranking (honest-metrics guardrail §10.5). |
| Secrets leak through matched lines into output or stored chunk | Redaction pipeline applied on both store and return; planted-secret test for both paths (guardrail §10.6, spec sec 12.3). |
| Over-wrapping small search outputs yields negative savings | Reuse P2 passthrough thresholds; audit records `passthrough`; `saved_pct` never falsely positive (spec sec 11). |
| Token-budget compression drops a critical match with no recovery | All omitted matches carry expandable chunk IDs; omitted counts surfaced; connector wording instructs agents to expand before assuming irrelevance (spec sec 6, guardrail §10.6). |
| `proxy_search_code` accidentally listed alongside a `mega_*` twin | New tool has no legacy twin in either naming mode; `tools/list` e2e (proxy + legacy) asserts a single entry (guardrail §10.2, spec sec 5.3). |

### Exit Gate
Maps every PR 4 / Deliverable 5 acceptance criterion (spec sec 14-D5 and sec 9.5; roadmap §6) — each line below has at least one matching Acceptance Scenario:
- [ ] **Works without index** — search returns live rg results when no index exists; `index_enrichment.status = unavailable`. (spec 14-D5, 9.5) → P3-AS2
- [ ] **Works with stale index** — search returns live rg results when index is stale; `index_enrichment.status = skipped_stale_index` with optional `mega index build` suggestion. (spec 14-D5, 9.5) → P3-AS3
- [ ] **Live rg/filesystem results are source of truth** — returned `files` derive solely from live rg matches. (spec 14-D5, 9.5) → P3-AS1, P3-AS5
- [ ] **Stale/missing index does not fail the tool** — probe failures (absent/stale/exception) are non-fatal; tool exits success. (spec 14-D5, 9.3) → P3-AS2, P3-AS3
- [ ] **Index enrichment never overrides live matches** — enrichment only annotates files already present and never reorders. (spec 9.5) → P3-AS5
- [ ] **Index enrichment clearly marked when used/skipped** — `index_enrichment.status` set in output **and** audit. (spec 14-D5, 9.5) → P3-AS2, P3-AS3, P3-AS4
- [ ] **Results grouped by file** — output is per-file with match counts and snippets. (spec 14-D5) → P3-AS1
- [ ] **Noisy / low-value matches collapsed** — duplicates and low-value matches omitted within budget, with omitted counts. (spec 14-D5) → P3-AS7
- [ ] **Task relevance used** — `task` feeds the shared scorer when engine ranking is on; honest base-relevance ordering when off (no false engine claim). (spec 14-D5, sec 8) → P3-AS1, P3-AS11
- [ ] **Raw search results stored** — raw rg stdout+stderr stored unchanged in content-store. (spec 14-D5, 9.5) → P3-AS1
- [ ] **Output expandable** — omitted/per-file raw retrievable via expandable chunk IDs (`proxy_expand_chunk`). (spec 14-D5, 9.5) → P3-AS8
- [ ] **Search execution respects existing command policy** — rg runs through the existing allowlist/wrapper; out-of-policy binary/path/glob/flag denied with no subprocess. (spec 14-D5, 9.5) → P3-AS9
- [ ] **Metrics recorded** — D7-core savings/usage metrics emitted and visible in `proxy_stats`. (spec 14-D5) → P3-AS1, P3-AS6
- [ ] **Raw rg output stored and expandable** (spec 9.5 restatement) — verified via expand round-trip returning verbatim raw with original ANSI. → P3-AS8
- [ ] **Small-output passthrough honest** — sub-threshold search outputs passthrough; no fake positive savings (spec 11.4, cross-ref D5). → P3-AS6
- [ ] **Zero-match handled cleanly** — empty result returns valid response + metrics, no error (spec 14-D5 implied "works"; sec 9.2 normal operation). → P3-AS12
- [ ] **No duplicate proxy + legacy listing** — `proxy_search_code` listed once in proxy mode, no `mega_*` twin in either mode (guardrail §10.2; spec sec 5.3). → P3-AS13, P3-AS14

### Acceptance Scenarios
- **P3-AS1 (happy path):** *Given* a repo with matches and no special config, *When* the agent calls `proxy_search_code` with a `query` and `task`, *Then* it receives results grouped by file, ranked, compressed, with per-file `reason`, expandable chunk IDs, and savings metrics; raw rg output is stored.
- **P3-AS2 (missing index):** *Given* no index has been built, *When* the agent searches, *Then* search returns live rg results normally and `index_enrichment.status = unavailable` with an optional `mega index build` suggestion; no error.
- **P3-AS3 (stale index):** *Given* files were edited after indexing, *When* the agent searches, *Then* search returns live rg results and `index_enrichment.status = skipped_stale_index` with optional suggestion; live matches are unchanged.
- **P3-AS4 (fresh index enrichment):** *Given* a fresh index, *When* the agent searches, *Then* selected files are annotated with block names, related symbols, and related tests; no enrichment-only file appears; `index_enrichment.status = available`.
- **P3-AS5 (enrichment never overrides):** *Given* the index lists a symbol in a file rg did not match, *When* the agent searches, *Then* that file does not appear in `files` and live result order is unchanged; only live-matched files are returned.
- **P3-AS6 (small-output passthrough):** *Given* an rg result under the passthrough threshold, *When* the agent searches, *Then* a minimal passthrough is returned, audit records `passthrough`, metrics are present, and no fake positive savings are reported.
- **P3-AS7 (noisy large output):** *Given* a query matching hundreds of low-value lines, *When* the agent searches within `max_tokens`, *Then* low-value/duplicate matches are collapsed and listed under `omitted` with counts and expandable chunk IDs.
- **P3-AS8 (expand omitted):** *Given* a compressed response with omitted matches, *When* the agent calls `proxy_expand_chunk` on an omitted chunk ID, *Then* it receives the full verbatim raw matches including original ANSI.
- **P3-AS9 (policy denial):** *Given* a `path_scope`, glob, or flag outside the command allowlist, *When* the agent searches, *Then* the existing policy denies execution and no rg process runs; the denial is surfaced.
- **P3-AS10 (secret redaction):** *Given* a matched line containing a credential, *When* the agent searches, *Then* the credential is redacted in both the returned snippet and the stored chunk.
- **P3-AS11 (ranking flag off):** *Given* `MEGASAVER_ENGINE_RANKING=false` (or shared scorer absent), *When* the agent searches, *Then* results fall back to base output relevance ordering, `ranking_mode = base_relevance`, no second ranking engine is invoked, and no engine claim is made.
- **P3-AS12 (zero matches):** *Given* a query with no matches, *When* the agent searches, *Then* a clean empty result is returned with metrics and no error.
- **P3-AS13 (tools/list integrity — proxy):** *Given* default proxy naming mode, *When* `tools/list` is requested, *Then* `proxy_search_code` appears exactly once with a valid schema and no `mega_*` twin.
- **P3-AS14 (tools/list integrity — legacy):** *Given* `MEGASAVER_TOOL_NAMING=legacy`, *When* `tools/list` is requested, *Then* `proxy_search_code` (a new tool with no legacy twin) is not duplicated/paired, consistent with the naming-mode contract.

### Dependencies / Rollback / Estimate
**Upstream/downstream deps.** Upstream hard deps: **P0** (the tool is registered through the naming adapter; the P0 stub for `proxy_search_code` is wired to a real handler here) and the existing **command policy/allowlist, content-store, redaction, output-filter ANSI step, and stats/audit**. Per the locked roadmap ordering, P3 runs **parallel to P1/P2** once P0 lands and must **not** wait on P4. The **shared scorer (P4)** is a soft dep: P3 ships with a base-output-relevance fallback and a thin scorer adapter, so it functions before P4 and automatically gains memory/failure-history boosts after P4 merges. Downstream: **P4** ranks search output through the same adapter, and **P6** consumes the search replay-trace fields emitted here. The `mega index build` command and index module are pre-existing and read-only from P3's perspective.

**Rollback / feature-flag plan.** The capability is additive and gated by tool exposure: removing `proxy_search_code` from the naming registry (or shipping it disabled) reverts agents to native search with zero impact on existing tools. Index enrichment is independently disable-able and best-effort by design, so disabling it degrades to pure rg-first behavior. Ranking is gated by `MEGASAVER_ENGINE_RANKING`; off → honest base relevance with `ranking_mode = base_relevance`. No schema or behavior change to existing `mega_*`/`proxy_*` tools, so rollback cannot break installed connectors. Because rg runs only through the existing policy wrapper, disabling the tool also removes its only new exec surface.

**Size estimate (M–L, matches roadmap §1/§6).** The handler, rg argv builder, group-by-file parser, and compression/omission logic are the bulk of the work; the parser and the enrichment-status matrix carry the most test surface (two rg output formats × three+one index states × redaction × passthrough × zero-match). Justification for M–L rather than L: P3 reuses policy, content-store, redaction, ANSI strip, stats, and (soft) ranking — it integrates far more than it builds, and the riskiest shared-scorer abstraction is owned by P4. The L-leaning weight comes almost entirely from the fixture and test matrix (P3-T16) needed to prove rg-first source-of-truth and never-block-on-index behavior.

---

## Phase P4 — Narrow Engine-Aware Ranking

### Objective
Extract the existing context-pruner / LAMR-style scorer into a single shared ranking service and have Proxy Mode (compressor dispatch + `proxy_search_code`) call it instead of inventing a second engine. In v1.2 the scorer combines exactly three normalized `[0,1]` signals — `base_output_relevance`, `memory_boost`, `failure_history_boost` — with the locked `0.70 / 0.15 / 0.15` formula (spec sec 8.4), gated behind `MEGASAVER_ENGINE_RANKING`, emitting per-candidate explanations and feeding the replay trace. This phase ships the *mechanism* of memory-aware pruning; the *proof* (ablation benchmark, spec sec 18) is deferred to v1.4 and depends on P6 traces, not on this phase. The differentiator claim ("MegaSaver prunes with your project's memory", spec sec 1/sec 19) must remain honest: when memory or failure data is sparse, the explanation shows a *zero* contribution rather than implying influence that did not happen.

### In Scope
- Extract/expose the existing context-pruner scorer as a shared ranking service (`packages/ranking-core` *(illustrative — confirm in repo)*, or a refactor of `packages/context-pruner/scoring` *(illustrative — confirm in repo)*). One scorer, three callers (compressor dispatch, `proxy_search_code`, existing context-pruner context-pack path).
- Define a stable ranking-service input/output contract usable by both the compressor path (P2 Vitest/tsc chunked output) and `proxy_search_code` (P3 grouped file matches).
- Implement the three v1.2 signals with explicit normalization to `[0,1]` (spec sec 8.3, sec 8.4):
  - `base_output_relevance` — reuse existing BM25/output-matching relevance (no new matcher; spec sec 8.1).
  - `memory_boost` — derived from project structured memory (content-store / memory layer) for the candidate.
  - `failure_history_boost` — derived from prior recorded failures (stats/audit failure records).
- Combine via the locked formula `final_score = 0.70*base + 0.15*memory_boost + 0.15*failure_history_boost` (spec sec 8.4); weights are not configurable in v1.2.
- Per-candidate ranking explanation: contributing signal names, raw + normalized values, weight, weighted contributions, final score (spec sec 8.4 AC, Deliverable 6 AC).
- Feature flag `MEGASAVER_ENGINE_RANKING` (boolean) that fully disables engine-aware ranking and falls back to base relevance ordering only (spec sec 8.4, Deliverable 6 AC).
- Emit ranking data into the replay trace (candidate scores, selected vs omitted chunks, signal values, ranking mode/flags) — write into the structure P6 hardens; reference content-store IDs, not raw content (spec sec 12.2, sec 12.3, Deliverable 6 AC).
- Wire both compressor dispatch and `proxy_search_code` to the shared scorer for ordering/selecting chunks and excerpts; for search, the per-file `reason` is sourced from the explanation, and ranking is applied **after** live `rg` results are established as source of truth (spec sec 9.2, sec 9.5).
- Respect the P2 small-output passthrough rule: when a response is a minimal passthrough (spec sec 11), ranking is skipped and the trace records a minimal-metadata entry (no candidate scores).

### Out of Scope
- Repo index ranking signal — **deferred to v1.3** (spec sec 8.3, sec 17).
- Dependency support signal — **deferred to v1.3** (spec sec 8.3, sec 17).
- Recent-edit signal — **deferred to v1.3** (spec sec 8.3, sec 17).
- Rule efficacy / project-rule signal beyond basic failure history — **deferred to v1.3** (spec sec 8.3, sec 17).
- Full LAMR multi-signal scoring — **deferred to v1.3** (spec sec 8.3).
- Weight tuning / configurable weights — out; v1.2 weights are locked at `0.70/0.15/0.15` (spec sec 8.4).
- Benchmark harness, ablation ladder, public report, Proof-of-Done — **deferred to v1.4** (spec sec 12, sec 18). P4 only records the trace fields that make those cheap later (spec sec 12.4).
- Replay-trace *schema hardening*, expand-event linking, offline-replay packaging — owned by **P6 / Deliverable 10** (spec sec 12, PR 7). P4 only populates ranking fields into the structure P6 owns.
- New `proxy_*` or `mega_*` tool names — none introduced by P4; the shared scorer is an internal service, not an MCP tool, so it adds **no** entry to `tools/list` (guardrail 2, spec sec 5.4).
- Any new BM25 / second matcher or alternate ranking path — explicitly forbidden (spec sec 8.1, guardrail 3).
- Index-enrichment-driven reordering of `proxy_search_code` matches — enrichment must never override live matches (spec sec 9.5); ranking consumes live results only.

### Work Breakdown
| ID | Task | Detail | Size |
|---|---|---|---|
| P4-T1 | Audit existing context-pruner scorer | Locate current LAMR-style scoring in context-pruner; document its current signal set, normalization, call sites, and public surface so extraction preserves behavior for the context-pack consumer (spec sec 8.2). | M |
| P4-T2 | Capture pre-extraction golden | Record `context_pruner_baseline.golden.json` from the existing context-pack ranking on a fixed fixture set **before** any refactor (TDD: failing/locked baseline first). | S |
| P4-T3 | Extract shared ranking service | Move/expose scorer behind a stable module boundary (`packages/ranking-core` *(illustrative — confirm in repo)*). Existing context-pruner callers re-point to the same entry point; no behavior change for the existing consumer (spec sec 8.2). | L |
| P4-T4 | Define ranking-service contract | Single `RankRequest`/`RankResult` interface covering both candidate shapes (compressor chunks and search file/excerpt matches). Includes per-signal raw+normalized values, weight, contribution, and explanation block. | M |
| P4-T5 | Implement `base_output_relevance` adapter | Map existing BM25/output-matching score into the contract, normalized to `[0,1]`. No new matcher (spec sec 8.1, sec 8.3). | S |
| P4-T6 | Implement `memory_boost` signal | Pull candidate's project-memory association from existing memory/content-store layer; reduce to `[0,1]`. Explicit zero/default when no memory exists; stub provider for tests. | M |
| P4-T7 | Implement `failure_history_boost` signal | Derive from existing stats/audit failure records relevant to candidate (file/test/symbol); normalize to `[0,1]`; explicit default when no failure history; stub provider for tests. | M |
| P4-T8 | Implement locked combination formula | `0.70*base + 0.15*memory_boost + 0.15*failure_history_boost`. Assert each input ∈ `[0,1]`; clamp out-of-range raw before normalize; assert output ∈ `[0,1]`. Weights are constants, not config (spec sec 8.4). | S |
| P4-T9 | Feature flag `MEGASAVER_ENGINE_RANKING` | Boolean gate. Off ⇒ order by base relevance only, **no** memory/failure signals computed (short-circuit before provider calls), `ranking_mode=base_only`. On ⇒ full three-signal. Default per repo convention (see Interfaces). | S |
| P4-T10 | Ranking explanations | Per-candidate explanation: signal raw value, normalized value, weight, weighted contribution, final score; invariant `Σ contribution == final_score` (within tolerance). Surfaced in debug/audit (spec sec 8.4 AC) and available to replay trace. | M |
| P4-T11 | Wire compressor dispatch (P2) to shared scorer | Vitest/tsc chunk selection/ordering uses shared scorer when flag on; raw stored output unchanged and still expandable (guardrail 6). No scorer embedded in output-filter (spec sec 8.1, sec 8.4 AC). | M |
| P4-T12 | Wire `proxy_search_code` (P3) to shared scorer | Grouped file matches ranked/selected via shared scorer; per-file `reason` populated from explanation; ranking consumes live `rg` results only; enrichment never reorders (spec sec 9.5). | M |
| P4-T13 | Passthrough interaction | When P2 returns a minimal passthrough (spec sec 11), skip ranking; ensure trace records a minimal-metadata entry with no candidate scores; assert no provider calls made. | S |
| P4-T14 | Replay-trace ranking emission | Write candidate scores, selected/omitted chunk IDs, signal values, final scores, ranking mode/flags into the trace, referencing content-store IDs only (spec sec 12.2, sec 12.3). | M |
| P4-T15 | Single-scorer guard test | Import-graph/grep assertion that exactly one scoring implementation is reachable from output-filter, `proxy_search_code`, and context-pruner; no second additive formula (spec sec 8.1, sec 16, guardrail 3). | M |
| P4-T16 | Tests + fixtures | Unit (formula/normalization/clamp/flag/explanation/no-data), integration (compressor + search + context-pruner regression + single-scorer + trace), e2e, fixtures (memory/failure/base stub data + goldens). | M |

### Interfaces & Contracts

Environment flag:
```txt
MEGASAVER_ENGINE_RANKING=true|false
# true  → engine-aware ranking: base + memory_boost + failure_history_boost
# false → base_output_relevance ordering only; memory/failure signals NOT computed
#         (short-circuit before any memory/failure provider call)
# Default: must be explicit in connector docs. Recommended default `false` for v1.2
#          (opt-in differentiator) unless repo convention dictates otherwise
#          (illustrative — confirm in repo).
# Note: this flag is independent of MEGASAVER_TOOL_NAMING (P0); it never adds or
#       removes any MCP tool from tools/list (guardrail 2).
```

Shared ranking-service boundary — single entry point all three consumers call (`packages/ranking-core` *(illustrative — confirm in repo)*):
```ts
// RankRequest: consumer-agnostic. candidates are compressor chunks OR search excerpts.
interface RankRequest {
  taskText?: string;                 // optional task hint (spec sec 12.2 replay field)
  query?: string;                    // command / search query / file query
  consumer: "compressor" | "search" | "context_pack"; // dispatch origin
  flags: { engineRanking: boolean }; // resolved MEGASAVER_ENGINE_RANKING
  candidates: RankCandidate[];
}

interface RankCandidate {
  contentId: string;        // content-store ID — NEVER raw content (spec sec 12.3)
  chunkId: string;          // content-store chunk/excerpt ID
  filePath?: string;        // for memory/failure association
  symbol?: string;          // optional, for failure association
  baseRelevanceRaw: number; // pre-normalization base score from existing BM25/matcher
}

interface RankResult {
  rankingMode: "engine_aware" | "base_only";
  ranked: RankedCandidate[]; // sorted desc by finalScore; stable for equal scores
  selected: string[];        // chunkIds chosen for return
  omitted: string[];         // chunkIds dropped (still expandable — guardrail 6)
}

interface RankedCandidate {
  chunkId: string;
  finalScore: number;           // 0..1
  explanation: SignalExplanation[];
}

interface SignalExplanation {
  signal: "base_output_relevance" | "memory_boost" | "failure_history_boost";
  raw: number;          // pre-normalization (pre-clamp value as observed)
  normalized: number;   // 0..1 (after clamp+normalize)
  weight: number;       // 0.70 | 0.15 | 0.15
  contribution: number; // weight * normalized
}
```

Flag-off contract (base_only) — explicit so tests can assert it:
```txt
when flags.engineRanking == false:
  rankingMode               = "base_only"
  memory/failure providers  = NOT called
  ranked order              = base_output_relevance order (stable)
  explanation per candidate = exactly one entry: base_output_relevance
                              (weight 1.0, contribution == normalized base)
```

Locked combination (must not be configurable in v1.2; spec sec 8.4):
```txt
# raw inputs may be out of range; clamp before normalize
base_n    = clamp01(normalize(base_output_relevance_raw))
memory_n  = clamp01(normalize(memory_raw))      # 0 when no memory
failure_n = clamp01(normalize(failure_raw))     # 0 when no failure history

assert 0 <= base_n    <= 1
assert 0 <= memory_n  <= 1
assert 0 <= failure_n <= 1

final_score = 0.70 * base_n
            + 0.15 * memory_n
            + 0.15 * failure_n

assert 0 <= final_score <= 1
assert abs(sum(contribution) - final_score) <= EPS   # explanation integrity
```

Replay-trace ranking fields populated by P4 (subset of the P6/Deliverable-10 trace; references content-store IDs only; spec sec 12.2/12.3):
```json
{
  "rankingMode": "engine_aware",
  "flags": { "MEGASAVER_ENGINE_RANKING": true },
  "candidates": [
    {
      "chunkId": "cs:chunk:abc123",
      "signals": {
        "base_output_relevance": { "raw": 12.4, "normalized": 0.82 },
        "memory_boost":          { "raw": 1,    "normalized": 0.50 },
        "failure_history_boost": { "raw": 3,    "normalized": 1.00 }
      },
      "finalScore": 0.799
    }
  ],
  "selectedChunks": ["cs:chunk:abc123"],
  "omittedChunks": ["cs:chunk:def456"]
}
```

Passthrough trace shape (spec sec 11 + sec 12.4: trace written for passthrough with minimal metadata, no candidate scores):
```json
{
  "rankingMode": "base_only",
  "passthrough": true,
  "flags": { "MEGASAVER_ENGINE_RANKING": true },
  "candidates": [],
  "selectedChunks": [],
  "omittedChunks": []
}
```

Consumer boundaries (changed, not duplicated):
- `output-filter` compressor dispatch *(illustrative — confirm in repo)* calls the shared service; it does **not** contain its own scorer (spec sec 8.1, sec 8.4 AC, guardrail 3).
- `proxy_search_code` calls the same service for grouping/ranking; per-file `reason` is sourced from `SignalExplanation`; ranking runs on live `rg` results only (spec sec 9.5).
- Existing context-pruner context-pack path calls the same extracted service — single source of truth (spec sec 8.2).

### Module Touchpoints
- **context-pruner** — source of the scorer being extracted; its callers re-pointed to the shared service (spec sec 3, sec 8.2). *(path illustrative — `packages/context-pruner/scoring` — confirm in repo)*
- **packages/ranking-core** — new/relocated shared ranking service home (spec sec 8.2). *(illustrative — confirm in repo)*
- **output-filter** — compressor dispatch consumes shared scorer; no embedded scorer (spec sec 3, sec 8, guardrail 3). *(illustrative — confirm in repo)*
- **proxy_search_code** (P3 tool) — second consumer of shared scorer for grouped-match ranking; ranks live `rg` results only (spec sec 9, Deliverable 5).
- **content-store** — provides candidate content/chunk IDs; signals/trace reference IDs, never raw content (spec sec 3, sec 12.3, guardrail 6).
- **stats/audit** — source of `failure_history_boost` data; surfaces ranking explanations in debug/audit (spec sec 3, sec 8.4 AC).
- **memory layer** (project structured memory) — source of `memory_boost` (spec sec 8.3, product claim sec 1/sec 19).
- **redaction pipeline** — unchanged; ranking operates on already-stored content-store IDs, so no new raw text path is introduced that could bypass redaction (spec sec 3, guardrail 6).
- **replay trace** writer (P6/Deliverable 10) — P4 populates ranking fields into the P6-owned structure (spec sec 12.2, Deliverable 6 AC).

### Test Strategy
- **Unit — formula:** given fixed normalized signal values, assert `final_score == 0.70*base + 0.15*memory + 0.15*failure` to tolerance, and weights are exactly `0.70/0.15/0.15`. Pass = exact computed value; mutating any weight constant fails the test (spec sec 8.4).
- **Unit — normalization & clamp:** every signal output ∈ `[0,1]` for in-range, zero, max, negative, and over-1 raw inputs (clamped). Pass = no value escapes `[0,1]`; `final_score ∈ [0,1]` (spec sec 8.4).
- **Unit — flag off:** with `MEGASAVER_ENGINE_RANKING=false`, ordering equals base-relevance ordering, `rankingMode=base_only`, memory/failure providers are **not invoked** (assert via spy/mock). Pass = identical order to base-only baseline; explanation contains only `base_output_relevance` (spec sec 8.4 AC, Deliverable 6 AC).
- **Unit — flag on:** memory/failure boosts measurably reorder candidates vs base-only on a crafted case. Pass = a candidate with higher memory/failure boost outranks an equal-base candidate (spec sec 8.3).
- **Unit — explanation integrity:** explanation lists each contributing signal with raw, normalized, weight, contribution; `Σ contribution == final_score`. Pass = reconstruction matches final_score within tolerance (spec sec 8.4 AC).
- **Unit — no-data defaults (honest metrics):** candidate with no memory and no failure history ⇒ `memory_boost=0`, `failure_history_boost=0`, `final_score == 0.70*base`, and explanation shows zero contribution (not omitted, not implied). Pass = engine result equals base-only weighting for that candidate; audit shows the zeros (spec sec 8.3, product-claim honesty sec 1/sec 19).
- **Unit — stable sort on ties:** two candidates with identical final scores keep deterministic order. Pass = stable ordering across runs (prevents flaky goldens).
- **Integration — single scorer (no second engine):** import-graph/grep assertion that `output-filter`, `proxy_search_code`, and context-pruner all reach exactly one scoring implementation; no second additive formula exists. Pass = exactly one scoring implementation reachable (spec sec 8.1, sec 16, Deliverable 6 AC, guardrail 3).
- **Integration — compressor path (P2):** run Vitest/tsc compression with flag on; selected chunks ordered by `final_score`; raw still stored + expandable. Pass = selection matches scorer output; raw retrievable (spec Deliverable 3/4, guardrail 6).
- **Integration — search path (P3):** run `proxy_search_code` with flag on; grouped files ranked by scorer; per-file `reason` populated from explanation; live `rg` results remain source of truth; enrichment never reorders. Pass = ranking from scorer over live matches only (spec sec 9.5).
- **Integration — context-pruner regression:** existing context-pack ranking output unchanged after extraction. Pass = pre/post extraction outputs byte-identical against `context_pruner_baseline.golden.json` (TDD: baseline captured before refactor in P4-T2; spec sec 8.2).
- **Integration — replay trace:** compressed response writes ranking fields (candidate scores, selected/omitted, signal values, mode/flags) referencing content-store IDs; no raw content duplicated. Pass = trace present, IDs resolve, no raw duplication (spec sec 12.2, sec 12.3, Deliverable 6 AC).
- **Integration — passthrough:** small output below P2 threshold ⇒ ranking skipped, trace has minimal metadata, no candidate scores, no memory/failure provider calls. Pass = passthrough trace shape matches; providers not invoked (spec sec 11, sec 12.4).
- **e2e:** agent runs a proxy compress + a proxy search in one session with flag on; both outputs ranked, both traces recorded; flip flag off and rerun ⇒ base-only ordering, traces show `base_only`, providers not called. Pass = both modes behave per spec end-to-end (spec sec 8.4, Deliverable 6 AC).

### Fixtures
- `memory_present.json` — candidates with known project-memory associations of varying strength (none / weak / strong) to exercise `memory_boost` normalization and the zero default.
- `failure_history.json` — recorded failure records keyed by file/test/symbol (zero, one, many failures) to exercise `failure_history_boost` and the no-data default.
- `base_relevance_candidates.json` — candidate set with pre-computed `baseRelevanceRaw` values (including ties, zero, max, and out-of-range/negative) so reordering by boosts and clamping are deterministic.
- `compressor_chunks.fixture` — Vitest/tsc compressor chunk set (reuses P1/P2 fixtures) to feed the compressor consumer through the scorer.
- `search_matches.fixture` — grouped `proxy_search_code` match set (reuses P3 rg-output fixture, including a `skipped_stale_index` / `unavailable` enrichment case) to feed the search consumer.
- `passthrough_small.fixture` — raw output below the P2 passthrough threshold (spec sec 11) to verify ranking is skipped and the minimal-metadata trace is written.
- `expected_rankings.golden.json` — expected ordering, final scores, and explanations for flag-on and flag-off, per consumer (golden file for regression).
- `context_pruner_baseline.golden.json` — captured context-pack ranking output **before** extraction, to prove behavior preservation (TDD golden, produced by P4-T2).
- Fakes: stub memory provider and stub failure-history provider returning fixture data deterministically and recording call counts (to assert no-call on flag-off/passthrough); stub content-store returning candidate IDs without raw content.

### Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Scorer extraction changes existing context-pruner behavior (riskiest change in v1.2). | Capture `context_pruner_baseline.golden.json` **before** refactor (P4-T2, TDD); assert byte-identical post-extraction; extract behind same entry point, no signal-set change for existing consumer (spec sec 8.2). |
| A second scorer / second additive formula sneaks into output-filter. | Import-graph/grep integration test (P4-T15) asserting exactly one scoring implementation; code-review guardrail; spec sec 8.1/8.4 AC + guardrail 3 enforced in exit gate. |
| Signals not truly normalized ⇒ skewed combination. | Unit tests clamp + assert `[0,1]` on every signal incl. negative and over-1 raw inputs; assert `final_score ∈ [0,1]` (spec sec 8.4). |
| Missing/empty memory or failure data treated as error. | Explicit zero defaults (`memory_boost=0`, `failure_history_boost=0`); no-data test ⇒ `final_score == 0.70*base`. |
| Overclaiming "memory-aware" when memory layer is sparse (honesty risk). | Explanation surfaces actual contribution; zero memory ⇒ zero contribution, shown explicitly in audit, never hidden or implied (spec sec 1/sec 19; guardrail 5 spirit). |
| Index enrichment leaks into ranking and reorders live `rg` matches. | Scorer consumes live results only; `search_matches.fixture` includes stale/unavailable enrichment; integration test asserts enrichment never reorders (spec sec 9.5). |
| Two consumer shapes (chunks vs search matches) force interface rework. | Design `RankCandidate` against both consumers up front (P3 landed before P4 per locked order); single contract test covering both shapes. |
| Replay-trace fields drift from P6 schema. | P4 writes only the ranking subset into the P6-owned structure; coordinate field names with P6/Deliverable 10; reference content-store IDs only (spec sec 12.3). |
| Flag-off path still pays cost of computing boosts. | Flag-off short-circuits **before** any memory/failure provider call; unit test asserts providers not invoked when off. |
| Passthrough path wastes work or writes misleading scores. | Ranking skipped on passthrough; minimal-metadata trace; provider-call-count assertion (spec sec 11, sec 12.4). |
| Ranking introduces a new MCP tool or duplicate name. | Scorer is internal service, not an MCP tool; no change to `tools/list`; verified against guardrail 2 (spec sec 5.4). |

### Exit Gate
- [ ] Shared scorer is reused or extracted — Proxy Mode calls the existing context-pruner/LAMR scorer, not a copy (spec Deliverable 6 AC; sec 8.2). *(P4-AS1, P4-AS4, P4-AS5)*
- [ ] No second ranking engine is created — exactly one scoring implementation exists and both consumers + context-pruner reach it (spec Deliverable 6 AC; sec 8.1; sec 16; guardrail 3). *(P4-AS4)*
- [ ] Signal values are normalized to `[0,1]` before combination, including out-of-range raw inputs (spec Deliverable 6 AC; sec 8.4). *(P4-AS9)*
- [ ] v1.2 uses only the three signals — `base_output_relevance`, `memory_boost`, `failure_history_boost`; no index/dependency/recent-edit/rule-efficacy signals (spec Deliverable 6: "Do not include full index/dependency/recent-edit signals in v1.2"; sec 8.3). *(P4-AS1, P4-AS3)*
- [ ] Combination uses the locked formula `0.70*base + 0.15*memory_boost + 0.15*failure_history_boost` and weights are not configurable (spec sec 8.4). *(P4-AS1, P4-AS12)*
- [ ] Ranking explanation is available and shows which signals contributed, with raw, normalized, weight, contribution; `Σ contribution == final_score` (spec Deliverable 6 AC; sec 8.4 AC). *(P4-AS10)*
- [ ] Feature flag `MEGASAVER_ENGINE_RANKING` can fully disable engine-aware ranking; off ⇒ base-only ordering with memory/failure signals **not computed** (spec Deliverable 6 AC; sec 8.4). *(P4-AS2)*
- [ ] `output-filter` (compressor dispatch) uses shared scoring logic, not a duplicate scorer (spec sec 8.4 AC). *(P4-AS4, P4-AS6)*
- [ ] Replay trace records candidate scores and selected chunks, referencing content-store IDs (spec Deliverable 6 AC; sec 12.2; sec 12.3). *(P4-AS1)*
- [ ] No-data candidate ⇒ `memory_boost=0`, `failure_history_boost=0`, `final_score == 0.70*base`; zero contribution shown honestly in audit (spec sec 8.3; honesty sec 1/sec 19). *(P4-AS3)*
- [ ] Existing context-pruner context-pack ranking output unchanged after extraction (golden-identical) (spec sec 8.2). *(P4-AS5)*
- [ ] Passthrough responses skip ranking and write a minimal-metadata trace with no candidate scores (spec sec 11; sec 12.4). *(P4-AS8)*
- [ ] `proxy_search_code` ranks live `rg` results only; index enrichment never reorders live matches; per-file `reason` sourced from explanation (spec sec 9.5). *(P4-AS7)*
- [ ] P4 adds no new MCP tool and no duplicate proxy/legacy tool name to `tools/list` (guardrail 2; spec sec 5.4). *(P4-AS4)*

### Acceptance Scenarios
- **P4-AS1 (happy path, engine on):** Given `MEGASAVER_ENGINE_RANKING=true` and candidates with base/memory/failure signals, When the shared scorer ranks them, Then candidates are ordered by `0.70*base + 0.15*memory + 0.15*failure`, each carries an explanation, and the replay trace records scores + selected/omitted chunks referencing content-store IDs.
- **P4-AS2 (flag disabled):** Given `MEGASAVER_ENGINE_RANKING=false`, When ranking runs, Then ordering equals base-relevance only, `rankingMode=base_only`, memory/failure providers are not invoked, and the trace shows `base_only`.
- **P4-AS3 (no memory, no failure data):** Given a candidate with no project memory and no failure history, When engine ranking runs, Then `memory_boost=0`, `failure_history_boost=0`, `final_score == 0.70*base`, and the explanation shows the zero contributions explicitly — no error, no implied influence.
- **P4-AS4 (single-engine guarantee):** Given the built artifact, When the import/scoring graph is inspected, Then exactly one scoring implementation is reachable from output-filter, `proxy_search_code`, and context-pruner — no duplicate scorer, no second additive formula, and no new MCP tool added.
- **P4-AS5 (context-pruner regression):** Given the pre-extraction context-pack golden output, When ranking runs after extraction, Then context-pack ranking output is byte-identical to `context_pruner_baseline.golden.json`.
- **P4-AS6 (compressor consumer):** Given Vitest/tsc compressor chunks and engine on, When dispatch ranks chunks, Then selected chunks follow `final_score` ordering and raw output remains stored + expandable.
- **P4-AS7 (search consumer, low-confidence/stale-index path):** Given `proxy_search_code` results where index enrichment is `skipped_stale_index` or `unavailable`, When the scorer ranks grouped matches, Then ranking uses only live `rg` results + base/memory/failure signals, enrichment never reorders live matches, and per-file `reason` comes from the explanation.
- **P4-AS8 (small-output passthrough):** Given a raw output below the passthrough threshold (handled in P2, spec sec 11), When the response is a minimal passthrough, Then ranking is skipped, no memory/failure provider is called, and the trace records a minimal-metadata (passthrough) entry without candidate scores.
- **P4-AS9 (out-of-range raw signal):** Given a raw signal value outside `[0,1]` (negative or over 1), When normalization runs, Then the signal is clamped/normalized into `[0,1]` and `final_score ∈ [0,1]`.
- **P4-AS10 (explanation integrity):** Given a ranked candidate, When the explanation is read, Then the sum of per-signal `contribution` values equals `final_score` (within tolerance) and each entry lists raw, normalized, weight, contribution.
- **P4-AS11 (missing hook log irrelevant to ranking):** Given no Claude Code hook log present, When engine ranking runs, Then ranking and traces are unaffected (hook telemetry is a P5 metric concern, not a ranking input) — ranking never blocks on hook data.
- **P4-AS12 (failure-history boost effect):** Given two candidates with equal base relevance where one has recorded prior failures, When engine ranking runs, Then the candidate with failure history ranks higher and its explanation shows a non-zero `failure_history_boost` contribution.
- **P4-AS13 (tie stability):** Given two candidates with identical final scores, When they are ranked across repeated runs, Then their relative order is deterministic and goldens remain stable.

### Dependencies / Rollback / Estimate

**Dependencies (upstream/downstream).** Upstream: **P0** (tool naming, so the consuming tools are registered), **P1** (classifier category context feeds relevance), **P2** (compressor chunks are one consumer; passthrough rule must be respected), and **P3** (`proxy_search_code` grouped matches are the second consumer — locked order requires P3 before P4 so the shared contract is designed against both shapes; roadmap sec 1.1 Decision-locked Order A). Also depends on the existing context-pruner scorer, content-store IDs, the memory layer, and stats/audit failure records. Downstream: **P5** dashboards may surface ranking-derived counts; **P6/Deliverable 10** hardens the replay trace whose ranking fields P4 first populates. Critical-path: P0 → P1 → P2 → **P4** → P5 (roadmap sec 2). Ranking is *not* a dependency of P3 and does not reorder the locked phase sequence.

**Rollback / feature-flag plan.** `MEGASAVER_ENGINE_RANKING=false` fully disables engine-aware ranking and reverts to base-relevance-only ordering with zero memory/failure computation — the safe default and instant kill-switch needing no redeploy. The scorer *extraction* (P4-T3) is the irreversible part: it is a behavior-preserving refactor guarded by the `context_pruner_baseline.golden.json` regression test (captured in P4-T2 before any change), so rollback of the extraction means reverting the PR while the existing single scorer keeps serving the context-pruner path. Because the flag defaults to off (recommended), shipping P4 carries no behavior change until explicitly enabled, and it adds nothing to `tools/list` regardless of flag state (guardrail 2).

**Size estimate.** **Medium**, matching spec PR 5 / roadmap P4. The signal logic, formula, flag, and explanations are small and well-bounded (locked weights, three signals, `[0,1]` normalization with clamp). The cost and the single real risk concentrate in P4-T3 — extracting the existing context-pruner scorer into a shared service without changing its behavior for the current consumer while making the interface fit two new consumer shapes. With the golden-regression harness (P4-T2), the single-scorer guard test (P4-T15), and flag-gated rollout, this stays Medium rather than Large; the deferral of all multi-signal LAMR work to v1.3 (spec sec 8.3, sec 17) is what keeps it contained.

---

## Phase P5 — Adoption + Measurement (Hooks, Metrics, Connectors)

### Objective

Make MegaSaver Proxy Mode savings measurable and push agents toward `proxy_*` tools without overclaiming. P5 ships the universal proxy adoption metrics (D7-rest), the optional Claude Code `PreToolUse` telemetry hook installer (D9), the hook-based interception rate that surfaces only when a hook log exists, and the connector instruction blocks + README that bias agents to proxy tools (D8). Honest-metrics discipline is the load-bearing constraint: never present a hook-based interception rate, or any wording implying universal interception, without real hook data. P5 adds no new store, no second scorer, and no parallel proxy stack — it aggregates over the existing stats/audit and content-store records that P0–P4 already produce.

### In Scope

- **D7-rest universal adoption metrics** surfaced through `proxy_stats`: proxy adoption rate (`proxy_tool_calls / known_megasaver_tool_calls`), proxy call count, proxy calls by type, expand rate — **plus the remaining sec 7.2-A universal fields**: token savings from proxy-mediated calls, raw stored output count, average compression ratio. (Spec sec 7.2-A, sec 14-D7.)
- **Dashboard surfacing** of D7-core savings metrics already recorded in P2 (raw tokens, returned tokens, saved %, passthrough count, classifier category count, compressor usage count) on the same `proxy_stats` view, separated from interception. (Spec sec 14-D7.)
- **D9 hook installer** `mega hooks install claude-code`: writes a Claude Code `PreToolUse` hook entry that logs metadata-only tool-call records for `Read`, `Bash`, `Grep`, `Glob`, `LS` to `.megasaver/hooks/claude-tool-calls.jsonl`. (Spec sec 13.2–13.4, sec 14-D9.)
- **Hook script** that is fast, non-blocking, metadata-only, best-effort, **always exits 0**, safe when `.megasaver` is missing or the log is unwritable, never logs raw file contents, and never blocks/delays/aborts the original tool call. (Spec sec 13.4.)
- **Setup Doctor detection** (CLI `Agent Setup Doctor` **and** GUI `Agent Setup Doctor`) reporting hook telemetry installed/missing, plus integration with `mega mcp install claude`. (Spec sec 13.2, sec 13.7, sec 14-D9.)
- **Hook-based interception rate** (`proxy_eligible / (proxy_eligible + native_eligible_from_hook)`) computed and displayed **only when the hook log exists**; missing-hook path shows adoption-only output + the verbatim `mega hooks install claude-code` suggestion. (Spec sec 7.2-B, sec 7.3, sec 13.5, sec 13.6, sec 14-D7.)
- **D8 connector instruction blocks** biasing to `proxy_*` for read / search / test / typecheck / build-log / diff; native only when explicitly required; expand chunks before assuming omitted content is irrelevant. Update Claude Code, Cursor (if supported), and Codex/Gemini/Aider docs where present. (Spec sec 6, sec 14-D8.)
- **Agent-friendly MCP tool descriptions** that reinforce proxy preference (description text only, on the existing renamed `proxy_*` tools — no new tools, no schema duplication, no second naming set). (Spec sec 6, sec 5.4, sec 14-D8.)
- **README** explaining Proxy Mode is opt-in, using the approved one-liner + category-comparison wording and **no competitor-specific "DFMT-style" headline**. (Spec sec 4, sec 14-D8.)

### Out of Scope

- Universal/native interception rate without hook data — explicitly forbidden; only adoption is universal (spec sec 7.1, 7.3; guardrail 5).
- Hooks for any agent other than Claude Code; non-`PreToolUse` hook types; capturing native call args beyond the metadata fields in sec 13.3.
- Connector-specific adoption optimization / tuning — deferred to **v1.3** (spec sec 17, roadmap sec 12).
- Repo-index/dependency/recent-edit ranking signals, ESLint/git-diff/Next.js/Jest/Playwright compressors, rich expand policies, auto budget — **v1.3** (spec sec 8.3, sec 17).
- Benchmark harness, public benchmark report, ablation ladder, Proof-of-Done — **v1.4**; P5 only ensures adoption/interception metrics are honest enough to feed them later (spec sec 18).
- Replay trace schema hardening / offline-replay prep — **P6 / D10** (spec sec 12, sec 14-D10).
- New ranking logic or a second scorer — owned by P4; P5 consumes its recorded outputs only (spec sec 8, sec 14-D6; guardrail 3).
- Changing tool naming mode, classifier, compressors, passthrough thresholds, or `proxy_search_code` behavior — owned by P0–P3.
- New raw storage: P5 references existing content-store counters; it does not store new raw output (guardrail 6).

### Work Breakdown

| ID | Task | Detail | Size |
|---|---|---|---|
| P5-T1 | Adoption-rate aggregator | Read existing stats/audit records to compute `proxy_adoption = proxy_tool_calls / known_megasaver_tool_calls`, proxy call count, calls-by-type, expand rate, **token savings from proxy-mediated calls, raw stored output count, average compression ratio** (sec 7.2-A full list). Reuse stats/audit + content-store counters; add no new store. | M |
| P5-T2 | `proxy_stats` adoption surfacing | Extend the existing `proxy_stats`/audit entry-point output to carry the D7-rest adoption block alongside the P2 D7-core savings block. Two clearly separated sections; signature unchanged. | M |
| P5-T3 | Hook installer CLI `mega hooks install claude-code` | Locate Claude Code settings/hooks config, idempotently add a `PreToolUse` matcher for Read/Bash/Grep/Glob/LS pointing at the shipped logger script. Detect support and no-op + clear message where unsupported. Wire into `mega mcp install claude`. Reuse existing command policy — no new permissions. | M |
| P5-T4 | Hook logger script | Standalone, dependency-light script. Reads `PreToolUse` payload from stdin/env, emits one JSONL metadata line to the hook log. mkdir-p best-effort; swallow all errors; **always `exit 0`**; never echo/log file contents; never block/delay/abort the tool call. | M |
| P5-T5 | Hook log ingester + interception calc | Parse `claude-tool-calls.jsonl`, classify entries as eligible native calls, join with proxy-eligible calls from audit, compute `interception_rate`. Tolerate missing/empty/corrupt/partial JSONL lines; ignore unknown fields. | M |
| P5-T6 | Missing-hook gating | When no readable hook log: omit interception entirely; emit the verbatim sec 13.6 string. Stats never error. | S |
| P5-T7 | Setup Doctor detection (CLI) | Add a hook-telemetry check to `Agent Setup Doctor` (CLI): installed (hook entry present) / missing (suggest install). Order near `mega mcp install claude`. | S |
| P5-T8 | Setup Doctor detection (GUI) | Mirror the CLI check in the GUI Agent Setup Doctor surface: installed/missing badge + install action, same detection logic reused (not re-implemented). | S |
| P5-T9 | Dashboard cards: adoption vs interception | Stats/dashboard renders adoption metrics always; interception card only when hook log present; explicit wording so users distinguish the two. No overclaim copy. | M |
| P5-T10 | Connector instruction block — Claude Code | Update the Claude Code connector instructions to prefer `proxy_*` for read/search/test/typecheck/build-log/diff; native only when explicitly required; expand before assuming omitted content irrelevant. Use the canonical block verbatim. | S |
| P5-T11 | Connector instruction blocks — Cursor + Codex/Gemini/Aider | Apply the same canonical block to Cursor (only if supported) and to Codex/Gemini/Aider docs where present. Skip cleanly where a connector is absent. | M |
| P5-T12 | Agent-friendly MCP tool descriptions | Tune description strings on the existing `proxy_*` tools to reinforce proxy preference. Description text only — no new tools, no duplicate schemas, no legacy+proxy double listing. | S |
| P5-T13 | README update | Proxy Mode is opt-in; use approved one-liner + category comparison; **remove/avoid any "DFMT-style" headline**. Grep guard for the forbidden phrase in headings. | S |
| P5-T14 | Audit/metrics wording pass | Ensure all metric/audit/dashboard copy distinguishes adoption from interception and never implies universal interception. Lint-enforced. | S |

### Interfaces & Contracts

Environment / config (P5 introduces no new behavior flags; interception display is gated purely on hook-log presence, not a flag — see Risks):

```txt
# Hook log location (relative to project root). Fixed by spec sec 13.3.
.megasaver/hooks/claude-tool-calls.jsonl

# Optional override for tests/CI only (illustrative — confirm in repo):
MEGASAVER_HOOK_LOG_PATH=<absolute path>   # defaults to .megasaver/hooks/claude-tool-calls.jsonl
```

Adoption denominator contract (pin this precisely so the aggregator and tests agree):

```txt
known_megasaver_tool_calls
  = count of audit records attributable to MegaSaver-mediated tool invocations
    in the selected window — i.e. proxy_* calls PLUS any legacy mega_* calls
    recorded by the same stats/audit entry (sec 3 mapping). It is the set of
    calls MegaSaver can actually see; it does NOT include native Read/Bash/Grep
    that bypass MegaSaver (those are only ever visible via the hook log).
proxy_tool_calls
  = subset of known_megasaver_tool_calls whose tool name is a proxy_* tool.
zero-denominator: known_megasaver_tool_calls == 0  ⇒  proxy_adoption_rate = 0.0
  (defined, never divide-by-zero; asserted in tests).
```

CLI surface:

```txt
mega hooks install claude-code
  → installs Claude Code PreToolUse telemetry hook where supported
  → idempotent (re-run = no duplicate hook entry)
  → exit 0 on success or "already installed"
  → on unsupported target: exit 0 + clear "not yet available / not supported here" message
  → non-zero only on a real, reportable install error (e.g. settings file unreadable/corrupt)

mega mcp install claude   # existing flow — now offers/triggers hook install step
mega doctor               # Agent Setup Doctor (CLI)
  → reports: "Claude Code hook telemetry: installed" | "missing (run: mega hooks install claude-code)"
# GUI Agent Setup Doctor mirrors the same installed/missing detection + an install action.
```

`proxy_stats` MCP tool — same tool/entry point as P0 (`proxy_stats` ↔ existing stats/audit entry); P5 extends its output, signature unchanged. No new tool is registered (guardrails 2, 3):

```jsonc
// proxy_stats input (unchanged from existing stats/audit entry)
{
  "project_id": "string (optional)",
  "session_id": "string (optional)",
  "window": "string (optional, e.g. 'all'|'session')"
}
```

```jsonc
// proxy_stats output — adoption ALWAYS present; interception ONLY when hook log exists
{
  "savings": {                         // D7-core, recorded in P2, surfaced here
    "raw_tokens": 0,
    "returned_tokens": 0,
    "saved_pct": 0.0,
    "passthrough_count": 0,
    "classifier_category_count": { "vitest": 0, "typescript": 0, "generic_shell": 0, "unknown": 0 },
    "compressor_usage_count": { "vitest": 0, "typescript": 0 }
  },
  "adoption": {                        // D7-rest, universal — always present (sec 7.2-A full list)
    "proxy_adoption_rate": 0.0,        // proxy_tool_calls / known_megasaver_tool_calls
    "proxy_call_count": 0,
    "proxy_calls_by_type": { "proxy_read_file": 0, "proxy_run_command": 0, "proxy_search_code": 0, "proxy_expand_chunk": 0 },
    "expand_rate": 0.0,                // proxy_expand_chunk calls / compressed-response count
    "proxy_mediated_token_savings": 0, // token savings from proxy-mediated calls (sec 7.2-A)
    "raw_stored_output_count": 0,      // raw stored output count (sec 7.2-A) — from content-store counters
    "avg_compression_ratio": 0.0       // average compression ratio (sec 7.2-A)
  },
  "interception": null,                // null OR object below; null ⇒ render the install hint
  "interception_hint": "Proxy adoption metrics only. Claude Code hook telemetry not configured. Run: mega hooks install claude-code"
}
```

```jsonc
// interception object — present ONLY when a readable hook log exists
{
  "hook_present": true,
  "proxy_eligible_calls": 0,
  "native_eligible_calls_from_hook": 0,
  "hook_interception_rate": 0.0        // proxy_eligible / (proxy_eligible + native_eligible_from_hook); 0-denominator ⇒ 0.0
}
```

Hook log line format (one JSON object per line, append-only JSONL) — exactly the spec sec 13.3 shape:

```json
{ "timestamp": "2026-06-12T15:21:00.000Z", "agent": "claude-code", "tool": "Read", "category": "eligible_read", "filePath": "src/auth.ts", "sessionId": "abc123" }
```

```txt
Field contract:
  timestamp  — ISO-8601 UTC, set by hook
  agent      — always "claude-code"
  tool       — one of: Read | Bash | Grep | Glob | LS
  category   — eligibility tag. Spec sec 13.3 shows only "eligible_read" verbatim;
               other tags (e.g. eligible_command, eligible_search) are inferred per-tool
               (illustrative — confirm exact category vocabulary in repo). Ingester treats
               category as opaque eligibility metadata and does not hard-code beyond "eligible_*".
  filePath   — path string ONLY (metadata); never file contents; optional for non-file tools
  sessionId  — Claude Code session id
Forbidden: any field containing raw stdout/stderr/file body. Ingester ignores unknown fields and skips malformed lines.
```

Hook script behavior contract (function/service boundary):

```txt
stdin/env: Claude Code PreToolUse payload (tool name, tool input metadata)
side effect: best-effort append of one JSONL metadata line to MEGASAVER_HOOK_LOG_PATH
guarantees:
  - mkdir -p of .megasaver/hooks if absent (best-effort)
  - on ANY failure (no dir, unwritable, bad payload): swallow, write nothing, continue
  - NEVER reads or emits file contents
  - NEVER blocks / delays / aborts the tool call
  - ALWAYS exit 0
```

Connector instruction block (canonical text, reused verbatim across connectors — spec sec 6 / sec 14-D8):

```txt
Prefer proxy_* tools for reading files, searching code, running tests, running typecheck,
inspecting build logs, and reviewing diffs.
Use native tools only when explicitly required.
Expand chunks before assuming omitted content is irrelevant.
```

### Module Touchpoints

- **stats/audit** — adoption-rate aggregation, hook-log ingestion + interception calc, dashboard cards (adoption vs interception). Reuse, do not fork (spec sec 3, guardrail 3).
- **`proxy_stats` / stats entry point** (P0 mapping: `proxy_stats` ↔ existing stats/audit entry) — output extended with adoption + interception blocks; signature and tool identity unchanged.
- **content-store** — read-only counters for `raw_stored_output_count` and compression-ratio inputs; untouched otherwise (guardrail 6: raw always stored + expandable, owned upstream).
- **CLI / setup flows** — new `mega hooks install claude-code`; integration with `mega mcp install claude` and **Agent Setup Doctor (CLI + GUI)**. Hook installer + logger script live here `(illustrative — confirm in repo: packages/cli/hooks/, .megasaver/hooks/)`.
- **command policy / allowlist** — not modified; installer must not require new command permissions beyond existing ones (reuse, spec sec 3).
- **redaction pipeline** — relied upon implicitly: hook logs metadata only, so redaction is not the safety mechanism here, but README/audit example copy must pass existing redaction `(illustrative — confirm in repo)`.
- **Connector instruction docs** — Claude Code, Cursor, Codex/Gemini/Aider blocks `(illustrative — confirm in repo: docs/connectors/, connectors/*/instructions)`.
- **MCP tool descriptions** — on the existing renamed `proxy_*` tools (no new tool, no schema duplication, no legacy+proxy double listing; guardrail 2, spec sec 5.4).
- **README** — public messaging compliance (spec sec 4).

### Test Strategy

**Unit**
- Adoption math: `proxy_adoption_rate`, `expand_rate`, calls-by-type, `proxy_mediated_token_savings`, `raw_stored_output_count`, `avg_compression_ratio` from synthetic audit + content-store counters. Pass: exact values; denominator-zero → `0.0`, asserted, no divide-by-zero crash.
- Interception math: `proxy_eligible / (proxy_eligible + native_eligible_from_hook)`. Pass: correct rate; zero-denominator → `0.0`.
- Hook log ingester: parses valid JSONL; **skips** malformed/partial lines; ignores unknown fields; treats `category` as opaque; tolerates empty file. Pass: counts match expected; no throw on bad lines.
- Hook logger script: given a sample payload, appends exactly one well-formed line; given missing dir → creates it; given unwritable target → writes nothing and exits 0; given garbage/empty payload → exits 0. Pass: **exit code 0 in every case**; never emits any file-content field.
- Missing-hook gating: ingester over absent log → interception `null` + hint present. Pass: hint string equals the spec sec 13.6 wording exactly.
- Denominator definition: synthetic mix of proxy_* and legacy mega_* records → `known_megasaver_tool_calls` counts both; native-only hook records do NOT inflate it. Pass: count matches the pinned contract.
- README/audit copy lint: grep asserts the literal "DFMT" substring is absent in README headings; audit/dashboard copy contains both "adoption" and "interception" as distinct labels and contains no string implying a universal interception rate. Pass: forbidden-phrase count = 0.

**Integration**
- `proxy_stats` end-to-end with audit fixtures, **no** hook log: returns `savings` + full `adoption` block, `interception: null`, hint present. Pass: shape matches contract; all sec 7.2-A fields populated.
- `proxy_stats` with a hook-log fixture: returns populated `interception` block; adoption + savings still present and separated. Pass: numbers match fixture-derived expectations.
- `mega hooks install claude-code` against a fake Claude Code settings file: hook entry added once; re-run idempotent (no duplicate). Pass: single matcher entry; exit 0.
- `mega mcp install claude` integration: running the install flow offers/performs the hook install step and leaves Setup Doctor reporting "installed". Pass: hook present after the combined flow; exit 0.
- Setup Doctor (CLI): before install → "missing (run: mega hooks install claude-code)"; after install → "installed". Pass: both states reported correctly.
- Setup Doctor (GUI): same detection surface reports missing→installed and exposes the install action; reuses the CLI detection logic. Pass: both states + install action present.
- Connector blocks: each updated connector file contains the canonical instruction text verbatim and references `proxy_*` preference. Pass: text present per connector that exists; absent connectors skipped without error.

**Fixture**
- Hook-log JSONL fixtures (clean, mixed-eligibility, malformed-line, empty) drive ingester + interception tests deterministically.
- Audit-record + content-store-counter fixtures drive all adoption math (including the three sec 7.2-A fields) without running live tools.

**E2E**
- Simulated Claude Code session: install hook → run a mix of native (Read/Bash/Grep) and proxy calls including at least one `proxy_expand_chunk` → `proxy_stats` shows adoption (with non-zero expand rate) + a real interception rate. Pass: interception only appears post-install; adoption present throughout; expand event reflected in `expand_rate`.
- Hook safety e2e: with hook installed, force an unwritable `.megasaver` (perms) → the simulated native tool call still completes and the agent is unaffected. Pass: tool call succeeds, hook exits 0, no error surfaced to agent.

### Fixtures

P5 is a metrics/connectors phase (not P1/P2 output-classification), so fixtures are test data + fakes rather than terminal-output corpora:

- `hook-log.clean.jsonl` — well-formed entries across all five tools (Read/Bash/Grep/Glob/LS) with valid `eligible_*` categories.
- `hook-log.mixed.jsonl` — eligible native + entries that map to proxy-eligible, to exercise interception arithmetic.
- `hook-log.malformed.jsonl` — includes a truncated/partial last line, a non-JSON line, and a line with an unknown extra field; ingester must skip-or-ignore gracefully.
- `hook-log.empty.jsonl` — zero-byte file → ingester yields zero eligible; interception still computable (0-denominator → `0.0`).
- (no file) — missing-hook scenario → interception `null` + install hint.
- `audit-records.fixture.json` — synthetic proxy_* + legacy mega_* + known-megasaver call records (with call types + expand events) for adoption-rate, calls-by-type, expand-rate, and denominator tests.
- `content-store-counters.fixture.json` — synthetic raw-stored-output and raw/returned-token counters driving `raw_stored_output_count`, `proxy_mediated_token_savings`, and `avg_compression_ratio`.
- `claude-settings.fake.json` — stand-in Claude Code settings/hooks config for installer idempotency, `mega mcp install claude` integration, and Setup Doctor detection tests.
- `claude-settings.unsupported.json` — stand-in for a variant where `PreToolUse` is not supported, to exercise the no-op + documented-not-available path.
- `connector-blocks/` — minimal stand-in connector instruction files for Claude Code, Cursor, Codex/Gemini/Aider to assert verbatim text injection and clean skip when absent.
- README snapshot/grep fixture — asserts absence of "DFMT-style" headline and presence of the approved one-liner + category comparison.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Hook script blocks or slows the user's native tool call | Best-effort design: no network, no content reads, swallow all errors, **always exit 0**; e2e test forces unwritable log and asserts the tool call still completes. |
| Hook logs leak file contents | Contract forbids content fields; logger writes only metadata (path string, tool, session, category); unit test asserts no content field is ever emitted. |
| Overclaiming universal interception without hook data | Interception is `null` and hidden unless a readable hook log exists; missing-hook path shows adoption-only + the verbatim install hint; audit/dashboard-copy lint asserts no universal-interception wording (guardrail 5). |
| Installer creates duplicate hook entries on re-run | Idempotent install keyed on matcher identity; integration test re-runs and asserts a single entry. |
| Corrupt/partial JSONL crashes stats | Ingester skips malformed lines line-by-line; missing-hook never errors stats; fixtures cover malformed + empty. |
| "Where supported" ambiguity for the `PreToolUse` hook | Installer detects support and no-ops with a clear "not yet available / not supported here" message where unsupported; GA-DoD permits "explicitly documented as not yet available" as an acceptable state (spec sec 16, roadmap sec 11). |
| README accidentally reintroduces "DFMT-style" headline | Grep guard in test suite blocks the literal phrase in headings (guardrail 7). |
| Adoption denominator (`known_megasaver_tool_calls`) miscounts (e.g. native calls inflating it) | Denominator pinned in the contract (proxy_* + legacy mega_*, never native bypass); unit-tested against a mixed fixture; zero-denominator yields `0.0`. |
| New `category` tags drift from real Claude Code payloads | Ingester treats `category` as opaque `eligible_*` metadata; eligibility keyed on `tool`, not on an invented category vocabulary; fixtures cover unknown categories. |
| MCP tool-description edits accidentally add/duplicate a tool or re-expose legacy names | Description-text-only change; test asserts `tools/list` count and names unchanged, no legacy+proxy double listing (guardrail 2). |
| Connector docs drift across multiple agents | Single canonical instruction block reused verbatim; per-connector tests assert presence; absent connectors skipped cleanly. |
| GUI and CLI Setup Doctor diverge | GUI reuses the CLI detection logic (one detector, two surfaces); both states integration-tested. |

### Exit Gate

PR 6 / D7-rest (spec sec 14-D7), D8 (sec 14-D8), D9 (sec 14-D9), plus sec 7 + sec 13 criteria:

- [ ] **D7:** `proxy_stats` shows universal adoption metrics — adoption rate, proxy call count, proxy calls by type, expand rate, **plus the remaining sec 7.2-A fields**: proxy-mediated token savings, raw stored output count, average compression ratio. (sec 14-D7, sec 7.2-A) → AS1
- [ ] **D7:** Surfaced D7-core savings — raw tokens, returned tokens, saved %, passthrough count, classifier category count, compressor usage count — appear on the same view, separated from interception. (sec 14-D7) → AS1, AS3
- [ ] **D7:** Hook-based metrics (native eligible calls, proxy eligible calls, hook-based interception rate) appear **only when the hook log exists**. (sec 14-D7, sec 7.3) → AS1, AS3
- [ ] **D7:** Audit/dashboard wording does not overclaim — adoption and interception are clearly distinguished; no wording implies a universal interception rate without hook data. (sec 14-D7, sec 7.3) → AS3, AS15
- [ ] **D7:** Dashboard separates adoption from interception. (sec 14-D7) → AS3, AS15
- [ ] **D7:** Missing hook shows the install suggestion. (sec 14-D7, sec 13.6) → AS2
- [ ] **D8:** Claude Code instruction block updated to prefer `proxy_*` tools (read/search/test/typecheck/build-log/diff; native only when required; expand before assuming irrelevant). (sec 14-D8, sec 6) → AS11
- [ ] **D8:** Cursor instruction block updated if supported. (sec 14-D8) → AS12
- [ ] **D8:** Codex/Gemini/Aider docs updated if present; absent connectors skipped cleanly. (sec 14-D8) → AS12
- [ ] **D8:** MCP tool descriptions are agent-friendly and reinforce proxy preference — description text only, no new/duplicate tools. (sec 14-D8, sec 5.4) → AS16
- [ ] **D8:** README explains Proxy Mode is opt-in, with the approved one-liner + category comparison. (sec 14-D8, sec 4) → AS13
- [ ] **D8:** README avoids the competitor-specific "DFMT-style" headline. (sec 14-D8, sec 4) → AS13
- [ ] **D9:** `mega hooks install claude-code` installs the Claude Code `PreToolUse` telemetry hook where supported. (sec 14-D9, sec 13.2) → AS4
- [ ] **D9:** Hook logging is optional; missing hook log does not break stats. (sec 14-D9, sec 13.7, sec 13.6) → AS2
- [ ] **D9:** Hook logs metadata only — no raw file contents are logged. (sec 14-D9, sec 13.4, sec 13.7) → AS7
- [ ] **D9:** Hook always exits 0. (sec 14-D9, sec 13.4, sec 13.7) → AS5, AS6
- [ ] **D9:** Setup Doctor detects hook installed/missing. (sec 14-D9, sec 13.7) → AS4
- [ ] **D9:** Stats uses the hook only when present. (sec 14-D9, sec 13.6) → AS2, AS3
- [ ] **sec 13.4:** Hook is fast, non-blocking, best-effort; safe if `.megasaver` is missing or the log is unwritable; never blocks/delays/aborts the original tool call. (sec 13.4) → AS5, AS6
- [ ] **sec 13.5:** Interception computed as `proxy_eligible / (proxy_eligible + native_eligible_from_hook)`; zero-denominator handled. (sec 13.5) → AS3, AS9
- [ ] **sec 7.2-A:** Adoption computed as `proxy_tool_calls / known_megasaver_tool_calls` (denominator pinned) and reported for all connectors. (sec 7.2-A) → AS1
- [ ] **sec 13.2:** Installer integrates with `mega mcp install claude` + Agent Setup Doctor (CLI **and** GUI). (sec 13.2) → AS4, AS4b
- [ ] **GA-DoD:** Claude Code hook installer exists, or is explicitly documented as not yet available. (spec sec 16, roadmap sec 11) → AS14

### Acceptance Scenarios

- **P5-AS1 (happy path — adoption universal):** Given a project with proxy_* and known-megasaver calls (and content-store counters) recorded in audit and **no** hook log, When the agent calls `proxy_stats`, Then it returns `savings` + a full `adoption` block (rate, count, by-type, expand rate, proxy-mediated token savings, raw stored output count, average compression ratio), `interception: null`, and the install hint.
- **P5-AS2 (missing hook log):** Given no `.megasaver/hooks/claude-tool-calls.jsonl`, When `proxy_stats` runs, Then no interception rate is shown and the output reads exactly "Proxy adoption metrics only. Claude Code hook telemetry not configured. Run: mega hooks install claude-code" and stats does not error.
- **P5-AS3 (happy path — interception with hook):** Given the hook is installed and the log contains eligible native + proxy-eligible records, When `proxy_stats` runs, Then it returns a populated `interception` block with `hook_interception_rate` computed per sec 13.5, alongside (separated from) adoption + savings.
- **P5-AS4 (install + Setup Doctor detection, CLI):** Given Claude Code settings without the hook, When the user runs `mega hooks install claude-code` then `mega doctor`, Then the hook entry is added once and Setup Doctor reports "installed" (it reported "missing" before).
- **P5-AS4b (install via `mega mcp install claude` + GUI Doctor):** Given a fresh Claude Code setup, When the user runs `mega mcp install claude` and accepts the hook step, Then the hook is installed and the **GUI** Agent Setup Doctor shows the "installed" badge (it showed "missing" before) with an install action available.
- **P5-AS5 (hook safety — unwritable log):** Given the hook is installed but `.megasaver/hooks/` is unwritable, When Claude Code fires a `PreToolUse` Read, Then the logger writes nothing, exits 0, and the native Read still executes unaffected.
- **P5-AS6 (hook safety — missing `.megasaver`):** Given `.megasaver` does not exist, When the hook fires, Then it best-effort creates the dir or silently no-ops, exits 0, and never blocks/delays the tool call.
- **P5-AS7 (metadata-only guarantee):** Given a `PreToolUse` Read with a file path, When the hook logs, Then the JSONL line contains `filePath` (path string only), `tool`, `sessionId`, `category`, and contains **no** file contents or any field carrying stdout/stderr/file body.
- **P5-AS8 (malformed/stale hook log):** Given the hook log has truncated/non-JSON lines (e.g. from a crashed write) and a line with an unknown extra field, When the ingester reads it, Then malformed lines are skipped, unknown fields ignored, valid lines counted, and interception is still computed without error.
- **P5-AS9 (empty hook log → zero-denominator):** Given an empty hook log and zero proxy-eligible calls, When interception is computed, Then `hook_interception_rate` is `0.0` (no divide-by-zero) and rendering is sensible.
- **P5-AS10 (idempotent re-install):** Given the hook is already installed, When `mega hooks install claude-code` is re-run, Then no duplicate hook entry is created and the command exits 0.
- **P5-AS11 (connector bias — Claude Code):** Given the updated Claude Code connector block, When the agent reads it, Then it instructs preferring `proxy_*` for read/search/test/typecheck/build-log/diff, native only when explicitly required, and expanding chunks before assuming omitted content is irrelevant (verbatim canonical block).
- **P5-AS12 (connector skip — absent agent):** Given Codex/Gemini/Aider docs are not present, When the connector update runs, Then it skips them cleanly without error and updates only existing connectors (Cursor only if supported).
- **P5-AS13 (README compliance):** Given the README is built/linted, When the headline lint runs, Then no "DFMT-style" headline is present and the opt-in framing + approved one-liner/category comparison are present.
- **P5-AS14 (unsupported hook target):** Given a Claude Code variant where the `PreToolUse` hook is not supported, When `mega hooks install claude-code` runs, Then it no-ops with a clear "not yet available / not supported here" message, exits 0, and the GA-DoD documented-not-available state holds.
- **P5-AS15 (honest-metrics guard):** Given any stats/dashboard output path, When adoption is shown without hook data, Then no wording implies a universal interception rate and adoption/interception remain distinct labels (audit-copy lint enforces this).
- **P5-AS16 (tool-description integrity):** Given the agent-friendly MCP tool-description edits, When `tools/list` is inspected, Then descriptions reinforce proxy preference while the tool set, names, and schema count are unchanged — no new tool, no legacy+proxy double listing.

### Dependencies / Rollback / Estimate

**Dependencies (upstream/downstream).** Upstream: P0 must have shipped the `proxy_*` tool set and the `proxy_stats` entry point; P1–P4 must be in place so adoption "by type" can include `proxy_search_code` and so eligible proxy-call accounting is complete (roadmap critical path `P0→P1→P2→P4→P5`; P3 parallel). D7-core savings metrics and content-store counters are produced in P2 and only **surfaced** here. P5 reuses the existing stats/audit, content-store, command policy/allowlist, and redaction modules unchanged. Downstream: P6 (replay trace) is independent of P5 but both feed the v1.4 benchmark/ablations; honest adoption/interception metrics here become the adoption/interception inputs to the v1.4 metric set (spec sec 18).

**Rollback / feature-flag plan.** Each P5 surface fails safe and is independently reversible. The hook is opt-in by construction — uninstalling (removing the Claude Code hook entry) or simply never installing it leaves stats at adoption-only with the install hint; the hook script is best-effort and always exits 0, so even a broken hook cannot break the agent. Interception display is gated purely on hook-log presence (no flag), so removing the log instantly reverts to adoption-only. Connector instruction blocks, MCP tool descriptions, and README are documentation/string changes, revertible by reverting the doc commits without affecting runtime. If the adoption aggregator or ingester misbehaves, it can be reverted independently of D8/D9 since they share no runtime state beyond read-only audit + content-store records.

**Size estimate.** **M**, matching the roadmap's P5 sizing. Rationale: no new ranking/compression engine and no content-store writes — the work is aggregation over existing audit + content-store data (P5-T1/T2/T5), a small best-effort hook script + idempotent installer (P5-T3/T4), Setup Doctor wiring in two surfaces sharing one detector (P5-T7/T8), and documentation/description edits (P5-T10–T13). The only non-trivial engineering risk is the hook safety guarantees and the install/idempotency/detection loop across `mega mcp install claude` + CLI/GUI Setup Doctor; everything else is bounded glue and copy with strong, fixture-driven test coverage.

---

## Phase P6 — Replay Trace Hardening

### Objective
Record a structured replay trace for **every** Proxy Mode response — compressed, light-summary, and passthrough — so v1.4 can replay real recorded sessions and run the ablation ladder cheaply instead of relying on synthetic fixtures (spec sec 12.1, sec 18). Each trace captures the full ranking decision — classifier category/confidence, candidate/selected/omitted chunks, per-signal values, final scores, ranking mode, active feature flags, compressor identity, and the passthrough/light-summary/compressed decision (spec sec 12.2) — while referencing **content-store IDs only**, never duplicating raw outputs (spec sec 12.3). It links expand events back to the originating trace so omitted-vs-expanded analysis is possible offline (spec sec 12.2: "expand events linked later if user/agent expands"). P6 introduces **no new ranking engine, store, redaction, or audit module**; it is a read-only capture point plus an offline loader/validator over the existing content-store, redaction, stats/audit, and the P4 shared scorer (spec sec 2; roadmap sec 10 guardrails 1/3).

### In Scope
- Replay trace schema (versioned, forward-compatible) and a writer that emits one trace record per proxy response across all three decision paths (spec sec 12.2, sec 12.4).
- Trace emission for **all three response paths**: full compression, `1200–2000` light-summary band, and `<1200` minimal passthrough — with a minimal-metadata variant for the latter two (spec sec 11.2, sec 12.4: "passthrough decisions with minimal metadata").
- Content-store ID references for raw, candidate, selected, and omitted chunks/excerpts — **no raw payload duplication** in the trace (spec sec 12.3; sec 14-D10).
- Capture of ranking inputs/outputs from the **P4 shared scorer**: per-signal values (`base_output_relevance`, `memory_boost`, `failure_history_boost`), final scores, normalization, ranking mode, and active feature flags (`MEGASAVER_ENGINE_RANKING`, `MEGASAVER_TOOL_NAMING`) — read-only, no scorer fork (spec sec 8.2, sec 8.4, sec 14-D6).
- Capture of classifier category + confidence (from P1, sec 10.6) and compressor identity (from P2, sec 14-D3/D4), including the `unknown`/low-confidence generic-fallback path (spec sec 10.6).
- Expand-event linking: when `proxy_expand_chunk` (↔ `mega_fetch_chunk`, sec 5.3) retrieves an omitted **or** candidate chunk, append an expand event referencing the originating trace ID + chunk ID (spec sec 12.2).
- An offline replay-input loader/validator proving a trace alone (plus content-store) is sufficient to re-run ranking via the **shared P4 scorer** — the v1.4 enablement check (spec sec 12.4: "captures enough data to replay ranking offline"; sec 18).
- Trace storage location, file format, rotation/retention policy, and `proxy_stats`/audit surfacing of trace counts + trace-enabled status (reuses stats/audit; spec sec 3).
- Feature flag to enable/disable trace writing; redaction reuse so trace free-text fields (task text, command, search query) carry no secrets (spec sec 3 redaction; sec 12.3).
- Privacy guarantee enforcement: trace adds **no raw content beyond what content-store already holds** (spec sec 12.3 verbatim).

### Out of Scope
- The v1.4 benchmark harness, public benchmark report, Proof-of-Done, and proof-aware memory writes — P6 only records the traces that power them (spec sec 18; roadmap sec 12 v1.4).
- The actual ablation runs / ranking-variant comparisons — P6 proves a trace *can* be replayed but does not execute the ablation ladder (spec sec 12.4, sec 18).
- New ranking signals consumed by future ablation rungs: `repo index signal`, `dependency signal`, `recent-edit signal`, `rule efficacy` — deferred to v1.3; P6 reserves nullable/extensible schema slots but does **not** populate them (spec sec 8.3, sec 17; roadmap P4 defer list, sec 12).
- v1.3 compressors/classifier categories (ESLint, Jest, Playwright, git-diff/status, Next.js build, build_log, generic_log) — trace schema must accommodate their future `compressor`/`classifier` strings, but P6 emits only for v1.2 categories `vitest`/`typescript`/`generic_shell`/`unknown` (spec sec 10.4, sec 17).
- Any new ranking engine, scorer, content-store, audit pipeline, or redaction implementation — P6 reuses existing modules only (spec sec 2; roadmap sec 10 guardrails 1/3).
- The hook-based interception telemetry (`.megasaver/hooks/claude-tool-calls.jsonl`) and adoption/interception metrics — those are P5/D7/D9; P6 neither writes nor depends on the hook log (spec sec 13; roadmap P5).
- Live/streaming trace viewing UI or a trace replay *runner* product — only the recorded artifact + a loader/validator are in scope; richer tooling is v1.4.

### Work Breakdown
| ID | Task | Detail | Size |
|---|---|---|---|
| P6-T1 | Define versioned, forward-compatible replay trace schema | JSON Schema with `schema_version`, every spec sec 12.2 field, nullable v1.3 signal slots, content-store ID references only. Forward-compat read rule: unknown future fields ignored, unknown future `compressor`/`category` strings accepted. Document field-by-field with the sec 12.2 source line for each. | M |
| P6-T2 | Trace writer service (read-only capture point) | Single emission point hooked into the proxy response pipeline after classify→rank→compress, before return (mirrors P1 pipeline order, sec 10.2). Append-only JSONL per session/project. Reuses content-store + stats/audit; **introduces no new store** (guardrail 3). Atomic append; safe under concurrent proxy calls. | M |
| P6-T3 | Wire compressed-path capture (P2) | From the compression path: `raw_estimate`/`returned_estimate`, candidate/selected/omitted chunk IDs, compressor id, classifier category+confidence. Reuses the D7-core token numbers already computed in P2 (roadmap sec 5) — does not recompute. | M |
| P6-T4 | Wire ranking capture from shared scorer (P4) | Extend the **existing P4 scorer call-site** to surface per-signal values, final scores, normalization flag, ranking mode, active flags into the trace. **No scorer fork; read-only capture** (sec 8.2, guardrail 3). Satisfies sec 14-D6 P4↔P6 link. | M |
| P6-T5 | Passthrough + light-summary minimal trace | Emit minimal-metadata trace for `<1200` passthrough and `1200–2000` light-summary bands: decision + raw/returned tokens + classifier + content IDs; `ranking:null`, no candidate array (sec 11.2, sec 12.4). Honest savings: passthrough `saved_pct=0`; light-summary reports its real (small) saved %, never a fabricated number (sec 11.4, guardrail 5/6). | S |
| P6-T6 | Expand-event linking | On `proxy_expand_chunk` (↔ `mega_fetch_chunk`), append expand event `{trace_id, chunk_id, ts, tool}` joinable to the originating trace. Works for both omitted and candidate chunks. Thread `trace_id` through the expandable-chunk handle returned to the caller so the join cannot orphan (sec 12.2, sec 5.3). | M |
| P6-T7 | Content-ID-only enforcement + redaction reuse | Assert no raw-payload fields in any trace record (schema-level + runtime guard). Route every free-text field (`task_text`, `command`, `search_query`) through the **existing redaction pipeline** before write. Add guard + secret-injection tests (sec 12.3; guardrail 3/6). | S |
| P6-T8 | Offline replay loader + validator | Loader reconstructs ranking inputs from a trace + content-store and re-runs the **shared P4 scorer** (no second scorer). Validator asserts completeness: all candidate/chunk IDs resolvable, all required signals present when `ranking_mode=engine_aware`. Raises `ReplayIncompleteError` on any gap. v1.4 enablement proof (sec 12.4; guardrail 3). | M |
| P6-T9 | Feature flag + config | `MEGASAVER_REPLAY_TRACE=on|off` (default on; illustrative name — confirm in repo), retention/rotation config, storage path. Disabled → zero overhead, no file, byte-identical response (sec 12.4 scope; guardrail honest-no-side-effect). | S |
| P6-T10 | Stats/audit surfacing | `proxy_stats` reports trace count + trace-enabled status; audit wording states traces hold **metadata + content IDs only**, no additional raw (sec 12.3; reuses stats/audit, guardrail 3). | S |
| P6-T11 | Ablation-ladder schema coverage check | Test asserting recorded fields express each rung **in spec order** (sec 12.4 / sec 18): generic baseline → +memory boost → +failure history boost → +repo index signal → +dependency signal → full engine-aware ranking. v1.2 rungs (baseline/+memory/+failure) replayable from real data; v1.3 rungs (+index/+dependency) assert *nullable schema slot exists*, not populated. | M |
| P6-T12 | Retention / rotation / size guard + best-effort write | Cap trace volume (rotate by size/age, retention purge). Trace writing is best-effort/non-blocking, mirroring the spec sec 13.4 hook safety posture: a write failure is logged, never raised, and never alters or blocks the proxy response. | S |

### Interfaces & Contracts

Environment flags (illustrative names — confirm in repo):
```txt
MEGASAVER_REPLAY_TRACE=on|off                        # default: on
MEGASAVER_REPLAY_TRACE_DIR=.megasaver/replay         # default path (illustrative — confirm in repo)
MEGASAVER_REPLAY_TRACE_MAX_MB=128                    # rotation size cap (illustrative)
MEGASAVER_REPLAY_TRACE_RETENTION_DAYS=30             # retention (illustrative)
```

Trace file format — append-only JSONL, one record per proxy response (illustrative path — confirm in repo). Co-located under the existing `.megasaver/` runtime dir (precedent: `.megasaver/hooks/`, spec sec 13.2/13.3):
```txt
.megasaver/replay/<projectId>/<sessionId>.trace.jsonl
.megasaver/replay/<projectId>/<sessionId>.expand.jsonl   # expand events, joined by trace_id
```

Replay trace record schema (versioned JSON Schema — fields map 1:1 to spec sec 12.2). Forward-compatible read: additional future properties are permitted and ignored; future `compressor`/`category` strings accepted without schema bump within the `1.x` line:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MegaSaverReplayTrace",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version", "trace_id", "ts", "session_id", "project_id",
    "tool_name", "decision", "classifier", "tokens", "content_refs"
  ],
  "properties": {
    "schema_version": { "type": "string", "const": "1.2.0", "description": "1.x readers ignore unknown future fields" },
    "trace_id":   { "type": "string" },
    "ts":         { "type": "string", "format": "date-time" },
    "session_id": { "type": "string", "description": "spec sec 12.2: session ID" },
    "project_id": { "type": "string", "description": "spec sec 12.2: project ID" },
    "task_text":  { "type": ["string", "null"], "description": "spec sec 12.2: task text if provided; redacted; null if absent" },
    "tool_name":  { "type": "string", "enum": ["proxy_run_command", "proxy_read_file", "proxy_search_code", "proxy_expand_chunk"], "description": "spec sec 12.2: tool name (proxy naming mode)" },
    "invocation": {
      "type": "object",
      "additionalProperties": false,
      "description": "spec sec 12.2: command OR file path OR search query — exactly one populated",
      "properties": {
        "command":      { "type": ["string", "null"], "description": "redacted before write" },
        "file_path":    { "type": ["string", "null"] },
        "search_query": { "type": ["string", "null"], "description": "redacted before write" },
        "exit_code":    { "type": ["integer", "null"], "description": "spec sec 14-D3/D4: exit code preserved" }
      }
    },
    "classifier": {
      "type": "object",
      "required": ["category", "confidence"],
      "additionalProperties": false,
      "description": "spec sec 12.2: classifier result + confidence",
      "properties": {
        "category":   { "type": "string", "enum": ["vitest", "typescript", "generic_shell", "unknown"], "description": "v1.2 categories only (sec 10.4); v1.3 strings accepted by 1.x readers" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "fallback_to_generic": { "type": "boolean", "description": "true when low-confidence → generic output filter (sec 10.6)" }
      }
    },
    "tokens": {
      "type": "object",
      "required": ["raw_estimate", "returned_estimate"],
      "additionalProperties": false,
      "description": "spec sec 12.2: raw + returned token estimates",
      "properties": {
        "raw_estimate":      { "type": "integer", "minimum": 0 },
        "returned_estimate": { "type": "integer", "minimum": 0 },
        "saved_pct":         { "type": ["number", "null"], "description": "honest: 0 for passthrough, real value otherwise; never fabricated (sec 11.4)" }
      }
    },
    "compressor": { "type": ["string", "null"], "description": "spec sec 12.2: compressor used. vitest|typescript|generic|null for passthrough" },
    "decision": {
      "type": "string",
      "enum": ["passthrough", "light_summary", "compressed"],
      "description": "spec sec 12.2: passthrough/compressed decision (+light_summary band, sec 11.2)"
    },
    "index_enrichment": {
      "type": ["string", "null"],
      "enum": ["used", "unavailable", "skipped_stale_index", null],
      "description": "proxy_search_code only (sec 9.3); null for other tools"
    },
    "ranking": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "description": "spec sec 12.2: signal values + final scores + ranking mode/flags. null for passthrough/light_summary; populated when ranking ran",
      "properties": {
        "ranking_mode": { "type": "string", "enum": ["engine_aware", "base_only"], "description": "base_only when MEGASAVER_ENGINE_RANKING=false (sec 8.4)" },
        "flags": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "MEGASAVER_ENGINE_RANKING": { "type": "boolean" },
            "MEGASAVER_TOOL_NAMING":    { "type": "string", "enum": ["proxy", "legacy"] }
          }
        },
        "weights": {
          "type": "object",
          "additionalProperties": false,
          "description": "weight vector in effect (sec 8.4: 0.70/0.15/0.15)",
          "properties": {
            "base":          { "type": "number" },
            "memory_boost":  { "type": "number" },
            "failure_boost": { "type": "number" }
          }
        },
        "candidates": {
          "type": "array",
          "description": "spec sec 12.2: candidate chunks/excerpts + selected + omitted + signal values + final scores",
          "items": {
            "type": "object",
            "required": ["content_id", "signals", "final_score", "selected"],
            "additionalProperties": false,
            "properties": {
              "content_id":  { "type": "string", "description": "content-store ID — NOT raw text (sec 12.3)" },
              "signals": {
                "type": "object",
                "additionalProperties": false,
                "description": "v1.2 signals normalized [0,1] (sec 8.4); v1.3 slots nullable (sec 8.3)",
                "properties": {
                  "base_output_relevance": { "type": "number", "minimum": 0, "maximum": 1 },
                  "memory_boost":          { "type": "number", "minimum": 0, "maximum": 1 },
                  "failure_history_boost": { "type": "number", "minimum": 0, "maximum": 1 },
                  "repo_index_signal":     { "type": ["number", "null"], "description": "v1.3 slot — null in v1.2" },
                  "dependency_signal":     { "type": ["number", "null"], "description": "v1.3 slot — null in v1.2" },
                  "recent_edit_signal":    { "type": ["number", "null"], "description": "v1.3 slot — null in v1.2" }
                }
              },
              "final_score": { "type": "number" },
              "selected":    { "type": "boolean" },
              "omit_reason": { "type": ["string", "null"], "description": "non-null only when selected=false" }
            }
          }
        }
      }
    },
    "content_refs": {
      "type": "object",
      "required": ["raw_content_id"],
      "additionalProperties": false,
      "description": "spec sec 12.3: references content-store IDs, never raw payloads",
      "properties": {
        "raw_content_id":     { "type": "string", "description": "content-store ID of stored raw output" },
        "selected_chunk_ids": { "type": "array", "items": { "type": "string" } },
        "omitted_chunk_ids":  { "type": "array", "items": { "type": "string" } },
        "expand_chunk_ids":   { "type": "array", "items": { "type": "string" }, "description": "chunk IDs returned to caller as expandable" }
      }
    }
  }
}
```

Expand-event record schema (separate JSONL, joinable by `trace_id`):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MegaSaverExpandEvent",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "trace_id", "chunk_id", "ts", "tool"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.2.0" },
    "trace_id": { "type": "string", "description": "originating replay trace (sec 12.2: expand events linked later)" },
    "chunk_id": { "type": "string", "description": "content-store chunk expanded — ID only, not raw" },
    "ts":       { "type": "string", "format": "date-time" },
    "tool":     { "type": "string", "const": "proxy_expand_chunk", "description": "↔ mega_fetch_chunk (sec 5.3)" },
    "source":   { "type": ["string", "null"], "enum": ["omitted", "candidate", null], "description": "which set the expanded chunk came from" }
  }
}
```

Minimal passthrough / light-summary trace (decision=`passthrough` or `light_summary`) — same schema, with `ranking: null`, `compressor: null` (passthrough), `content_refs.raw_content_id` present, no candidate array. Passthrough example (honest `saved_pct=0`, sec 11.3/11.4):
```json
{
  "schema_version": "1.2.0",
  "trace_id": "tr_9f2c",
  "ts": "2026-06-12T15:21:00.000Z",
  "session_id": "abc123",
  "project_id": "proj_megasaver",
  "task_text": null,
  "tool_name": "proxy_run_command",
  "invocation": { "command": "npm test", "file_path": null, "search_query": null, "exit_code": 0 },
  "classifier": { "category": "vitest", "confidence": 0.91, "fallback_to_generic": false },
  "tokens": { "raw_estimate": 430, "returned_estimate": 430, "saved_pct": 0 },
  "compressor": null,
  "decision": "passthrough",
  "index_enrichment": null,
  "ranking": null,
  "content_refs": { "raw_content_id": "cs_7a1b", "selected_chunk_ids": [], "omitted_chunk_ids": [], "expand_chunk_ids": [] }
}
```

Offline replay loader contract (illustrative signature — confirm in repo). Re-runs the **shared P4 scorer**, never a second scorer (guardrail 3):
```txt
load_replay_inputs(trace_record, content_store) -> ReplayInputs
    # resolves every content_id / chunk_id against content-store (offline; no live FS)
    # returns candidate excerpts + signals + weights sufficient to re-run the shared P4 scorer
    # raises ReplayIncompleteError if any referenced ID is unresolvable
    #        or (ranking_mode=engine_aware) any required v1.2 signal is missing

validate_trace(trace_record) -> ValidationResult
    # schema validity (incl. forward-compat read) + content-ID-only invariant
    # + ablation-rung field coverage (sec 12.4 ladder, in order)
```

Service boundary (no new ranking/store/redaction/audit module introduced — guardrail 1/3):
```txt
proxy response pipeline ──(read-only capture)──► trace_writer ──► JSONL (append-only, atomic)
        │                                            │
        ├── classifier (P1) ── category, confidence  │
        ├── shared scorer (P4) ── signals, scores ───┤ reuses content-store IDs only (no raw)
        ├── compressor (P2) ── compressor id ────────┤ reuses redaction pipeline for free-text
        └── content-store ── raw_content_id, chunk ids┘ reuses stats/audit for counts
proxy_expand_chunk ──► expand_event_writer ──► expand JSONL (joined by trace_id)
```

### Module Touchpoints
- **output-filter / Context Gate** (spec sec 3) — proxy response pipeline; insertion of the read-only trace capture point after classify→rank→compress, before return (mirrors sec 10.2 order). Evolved, not rebuilt (guardrail 1).
- **content-store** (spec sec 3) — source of `raw_content_id` and all chunk IDs; trace references these, stores no raw payload. Reused, not forked.
- **stats/audit system** (spec sec 3) — trace count + trace-enabled status surfaced via `proxy_stats`; audit wording clarifies metadata + content IDs only.
- **redaction pipeline** (spec sec 3) — applied to `task_text` / `search_query` / `command` free-text before write.
- **context-pruner / shared scorer** (spec sec 3; `packages/ranking-core` or `packages/context-pruner/scoring` — illustrative path, confirm in repo) — read-only surfacing of signal values + final scores from the P4 call-site; **no second scorer** (sec 8.2).
- **compressor dispatch** (P2 modules — illustrative paths, confirm in repo) — emits `compressor` id and candidate/selected/omitted chunk IDs; reuses D7-core token numbers (roadmap sec 5).
- **MCP tool layer** for `proxy_expand_chunk` ↔ `mega_fetch_chunk` (spec sec 5.3) — expand-event hook; `trace_id` threaded through the expandable-chunk handle.
- **`.megasaver/` runtime dir** (spec sec 13.2/13.3 precedent for `.megasaver/hooks/`) — new `.megasaver/replay/` subtree (illustrative — confirm in repo).

### Test Strategy
- **Unit — schema completeness:** `trace_writer` builds a record from a synthetic pipeline result; assert **every** spec sec 12.2 field present. Pass: validates against `MegaSaverReplayTrace`; all required fields populated.
- **Unit — content-ID-only invariant:** feed a result containing raw text; assert trace contains zero raw-payload fields, only IDs. Pass: guard rejects/strips any non-ID content field (`additionalProperties:false` + runtime guard).
- **Unit — redaction reuse:** `task_text` / `command` / `search_query` each carrying an injected secret; assert the existing redaction pipeline runs before write. Pass: secret absent from trace file.
- **Unit — decision branching:** passthrough (`<1200`), light_summary (`1200–2000`), compressed (`≥2000`) each emit the correct variant. Pass: `ranking:null` for first two, populated candidates for compressed.
- **Unit — honest savings:** passthrough trace `saved_pct=0`; light_summary trace `saved_pct` equals the real measured (small) saving, never a fabricated positive. Pass: no fake savings (sec 11.4, guardrail 5/6).
- **Unit — forward-compat read:** a `1.x` reader ingests a record carrying an unknown future field and a v1.3 `compressor`/`category` string. Pass: record accepted, unknown field ignored, no crash.
- **Integration — compressed Vitest + tsc:** full runs through pipeline → trace with candidates, signals, scores, compressor id, classifier confidence, exit code. Pass: `load_replay_inputs` reconstructs ranking inputs without error.
- **Integration — base_only mode:** `MEGASAVER_ENGINE_RANKING=false` → trace records `ranking_mode=base_only`, no engine-signal requirement; replay still valid. Pass: validator passes in base_only mode.
- **Integration — expand linking (omitted):** compressed response → `proxy_expand_chunk` on an **omitted** chunk → expand event joins back to originating `trace_id`. Pass: join yields original trace; `source=omitted`.
- **Integration — expand linking (candidate):** `proxy_expand_chunk` on a **candidate** (non-omitted) chunk also produces a joinable event. Pass: `source=candidate`; no orphan.
- **Integration — search index states:** `proxy_search_code` trace carries `index_enrichment` for `used` / `unavailable` / `skipped_stale_index`. Pass: all three recorded; enrichment never overrides live rg candidates (sec 9.2/9.3).
- **Integration — unknown / generic fallback:** low-confidence output → generic filter; trace records `category` with low `confidence`, `fallback_to_generic=true`, compressor/ranking reflect the generic path (sec 10.6). Pass: all three consistent.
- **Integration — flag off:** `MEGASAVER_REPLAY_TRACE=off` → no trace file; proxy response byte-identical to trace-on output. Pass: zero artifacts, identical compact output.
- **Integration — write failure non-fatal:** unwritable `.megasaver/replay/` dir → response returns normally; failure logged, not raised (sec 13.4 posture). Pass: response unaffected.
- **Integration — concurrent append:** two proxy calls in the same session write concurrently. Pass: both records intact, JSONL not interleaved/corrupted (atomic append).
- **e2e — replay-readiness (v1.4 enablement gate):** record a session of N mixed proxy calls, then run `load_replay_inputs` over every trace **offline (no live FS)** and re-run the **shared P4 scorer**. Pass: scores reproduce within tolerance from trace+content-store alone.
- **e2e — ablation-rung coverage:** assert the recorded field set expresses each rung **in spec sec 12.4 / sec 18 order**: baseline → +memory → +failure → +repo-index → +dependency → full. Pass: baseline/+memory/+failure replayable from real data; +index/+dependency confirm nullable schema slot exists.

### Fixtures
- Synthetic pipeline-result objects for each `decision` band: `passthrough` (raw ~430 tok), `light_summary` (~1500 tok), `compressed` (~3500 tok) — reuse P1/P2 Vitest and tsc fixtures (sec 10.5) as the underlying raw outputs.
- A `compressed` **Vitest** result fixture: ≥3 candidate chunks (≥1 selected, ≥1 omitted with non-null `omit_reason`) and populated `memory_boost` / `failure_history_boost` signals.
- A `compressed` **tsc** result fixture: grouped errors → multiple candidate chunks, including a cascading-duplicate chunk omitted with `omit_reason` (sec 14-D4 collapse rules).
- A `generic_shell` and an `unknown` / low-confidence fixture (`fallback_to_generic=true`) to exercise the generic-filter path (sec 10.6).
- A `proxy_search_code` result fixture in each index state: `used`, `unavailable`, `skipped_stale_index` (sec 9.3).
- A redaction fixture with an injected fake secret in `task_text`, `command`, and `search_query`.
- A content-store **fake/stub** returning deterministic `content_id`/`chunk_id`s so the loader/validator resolve them offline (no live FS) — the e2e replay relies on this.
- An expand-event fixture pair (trace + subsequent `proxy_expand_chunk`) for both an **omitted** and a **candidate** chunk.
- A `base_only` fixture (`MEGASAVER_ENGINE_RANKING=false`) and an `engine_aware` fixture, to exercise both ranking modes.
- A forward-compat fixture: a record carrying an unknown future field and a v1.3 `compressor`/`category` string.
- A "golden" replay-trace JSONL file checked against the schema as a regression anchor.

### Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Trace duplicates raw output (violates spec sec 12.3 / D10 "does not duplicate raw output contents") | Content-ID-only guard test (P6-T7); schema `additionalProperties:false` forbids raw-payload fields; only content-store IDs stored. |
| Capturing ranking internals tempts a fork of the scorer (violates guardrail 3 / no second engine) | Read-only capture at the existing P4 call-site (P6-T4); no new scoring code; replay re-runs the **shared** scorer (P6-T8); review checklist enforces reuse. |
| Trace write latency/IO slows or fails the proxy response | Best-effort, non-blocking, append-only (P6-T12); failure logged not raised; flag to disable (P6-T9). |
| Schema too v1.2-specific → v1.4 ablations need index/dependency signals not present | Nullable v1.3 signal slots reserved now (P6-T1/T11); coverage test asserts the six-rung ladder is expressible. |
| Forward incompatibility — v1.3 strings/fields break v1.2 readers | `schema_version` + forward-compat read rule (P6-T1); unknown fields ignored, future category/compressor strings accepted; forward-compat test. |
| Secrets leak into trace via `task_text` / `command` / `search_query` | Route all free-text through existing redaction pipeline before write (P6-T7); secret-injection test on all three fields. |
| Trace volume grows unbounded on user disk | Size/age rotation + retention purge (P6-T9/T12); trace count surfaced in `proxy_stats` (P6-T10). |
| Passthrough/light-summary traces too thin or report fake savings | Minimal-metadata variant (P6-T5); passthrough `saved_pct=0`, light-summary reports real saving (sec 11.4, guardrail 5/6). |
| Expand events orphaned if `trace_id` not threaded to the chunk return | Embed `trace_id` in the expandable-chunk handle (P6-T6); join tests for both omitted and candidate chunks. |
| Replay loader silently incomplete → false v1.4 confidence | `ReplayIncompleteError` on any unresolvable ID / missing required signal; e2e replay-readiness gate (P6-T8). |
| Concurrent proxy calls corrupt the JSONL | Atomic append; concurrent-append integration test (P6-T2). |

### Exit Gate
- [ ] Replay trace records task text, candidate chunks/excerpts, signal values, selected chunks, and omitted chunks (spec sec 14-D10: "records task, candidates, signal values, selected chunks, omitted chunks"; sec 12.2). → P6-AS1
- [ ] Trace references content-store IDs (spec sec 12.4: "trace references content-store IDs"; sec 14-D10). → P6-AS1, P6-AS12
- [ ] Trace does **not** duplicate raw output contents — no raw beyond content-store (spec sec 12.3 + sec 14-D10: "does not duplicate raw output contents unnecessarily"). → P6-AS1, P6-AS11
- [ ] Trace captures enough data to replay ranking offline — a trace plus content-store is sufficient to re-run the shared scorer (spec sec 12.4: "captures enough data to replay ranking offline"; sec 14-D10: "supports offline replay"). → P6-AS12
- [ ] Trace supports the v1.4 ablation ladder, in order: generic output filter baseline → + memory boost → + failure history boost → + repo index signal → + dependency signal → full engine-aware ranking (spec sec 12.4 + sec 14-D10 + sec 18). → P6-AS13
- [ ] Replay trace is written for **compressed** proxy responses (spec sec 12.4: "replay trace is written for compressed proxy responses"). → P6-AS1
- [ ] Trace is written for **passthrough** decisions with minimal metadata (spec sec 12.4: "trace is written for passthrough decisions with minimal metadata"). → P6-AS2
- [ ] Trace is written for the **light-summary** band (decision=`light_summary`, minimal metadata) (spec sec 11.2 band + sec 12.4 "every compressed/decision response"). → P6-AS3
- [ ] No additional raw contents logged beyond what content-store already stores (spec sec 12.3: "Do not log additional raw contents beyond what content-store already stores"). → P6-AS11
- [ ] Ranking candidate scores and selected chunks are recorded by the trace, satisfying the P4↔P6 link (spec sec 14-D6: "replay trace records candidate scores and selected chunks"). → P6-AS1, P6-AS4
- [ ] Expand events are linked back to the originating trace when a user/agent expands (spec sec 12.2: "expand events linked later if user/agent expands"). → P6-AS5
- [ ] Ranking mode / feature flags and compressor used are captured (spec sec 12.2: "ranking mode / feature flags", "compressor used"). → P6-AS1, P6-AS4
- [ ] Classifier result + confidence captured, including low-confidence generic fallback (spec sec 12.2: "classifier result", "classifier confidence"; sec 10.6). → P6-AS8
- [ ] No new store/scorer/redaction/audit module; reuses content-store, shared P4 scorer, redaction, stats/audit (spec sec 2; roadmap sec 10 guardrails 1/3). → P6-AS12 (shared scorer reproduces scores)

### Acceptance Scenarios
- **P6-AS1 (happy path, compressed)** — Given a `≥2000`-token Vitest output, When `proxy_run_command` compresses and ranks it, Then a trace is written with classifier category+confidence, candidate chunks with per-signal values and final scores, selected/omitted chunk IDs, `compressor="vitest"`, `decision="compressed"`, ranking mode + flags, and `content_refs` pointing **only** to content-store IDs (no raw).
- **P6-AS2 (small-output passthrough)** — Given a `<1200`-token output, When passthrough returns, Then a minimal-metadata trace is written (`decision="passthrough"`, `ranking:null`, `compressor:null`, `raw_estimate==returned_estimate`, `raw_content_id` present) and `saved_pct=0` (no fake savings).
- **P6-AS3 (light-summary band)** — Given a `1200–2000`-token output, When light-summary returns, Then a trace with `decision="light_summary"`, `ranking:null`, both token estimates, real (small) `saved_pct`, and content IDs is written.
- **P6-AS4 (engine ranking disabled)** — Given `MEGASAVER_ENGINE_RANKING=false`, When a compressed response is produced, Then the trace records `ranking_mode="base_only"`, omits engine-signal requirements, captures the flags + compressor, and still validates for offline replay.
- **P6-AS5 (expand linking, omitted)** — Given a compressed response with omitted chunks, When the agent calls `proxy_expand_chunk` on an omitted chunk, Then an expand event is appended that joins back to the originating `trace_id`, references the expanded `chunk_id`, and marks `source="omitted"`.
- **P6-AS6 (expand linking, candidate)** — Given a compressed response, When `proxy_expand_chunk` retrieves a candidate (non-omitted) chunk, Then a joinable expand event with `source="candidate"` is appended; no orphan.
- **P6-AS7 (search, missing index)** — Given `proxy_search_code` runs with no index, When the trace is written, Then `index_enrichment="unavailable"` is recorded and live rg matches are the candidates (enrichment never overrides live results, sec 9.2).
- **P6-AS8 (search, stale index)** — Given `proxy_search_code` with a stale index, When the trace is written, Then `index_enrichment="skipped_stale_index"` is recorded; search did not fail.
- **P6-AS9 (low-confidence / generic fallback)** — Given output the classifier scores below threshold, When it falls back to the generic output filter, Then the trace records `category` with low `confidence`, `fallback_to_generic=true`, and ranking/compressor reflect the generic path (sec 10.6).
- **P6-AS10 (flag disabled, no trace)** — Given `MEGASAVER_REPLAY_TRACE=off`, When any proxy response is produced, Then no trace file is created and the compact output is byte-identical to the trace-on output.
- **P6-AS11 (privacy / secret + no raw)** — Given `task_text`, `command`, and `search_query` each containing a secret, When the trace is written, Then every secret is redacted via the existing redaction pipeline and absent from the trace, and the trace holds no raw output beyond content-store IDs (sec 12.3).
- **P6-AS12 (offline replay-readiness)** — Given a recorded session of mixed proxy calls, When `load_replay_inputs` runs offline against trace+content-store with no live filesystem and re-runs the **shared P4 scorer**, Then ranking inputs reconstruct and the recorded scores reproduce within tolerance — proving no second scorer is needed and the v1.4 enablement gate holds.
- **P6-AS13 (ablation-rung coverage)** — Given recorded engine-aware traces, When the coverage check runs over the spec ladder in order (baseline → +memory → +failure → +repo-index → +dependency → full), Then baseline/+memory/+failure rungs are replayable from real data and the +repo-index/+dependency rungs confirm a nullable schema slot exists (populated in v1.3, not P6).
- **P6-AS14 (write failure non-fatal)** — Given an unwritable `.megasaver/replay/` dir, When a proxy response is produced, Then the response returns normally and the trace failure is best-effort (logged, not raised), mirroring the sec 13.4 hook posture.

### Dependencies / Rollback / Estimate

**Upstream/downstream deps.** P6 hard-depends on **P2** (compressors emit raw/returned tokens, compressor id, candidate/selected/omitted chunks — and the D7-core token numbers P6 reuses, roadmap sec 5) and **P4** (shared scorer exposes per-signal values, final scores, ranking mode, flags) — per roadmap sec 1 and the dependency graph (`P2 + P4 → P6`, sec 2). It also reads **P1** classifier output (category/confidence, incl. generic fallback), **P3** `proxy_search_code` `index_enrichment` state, and the content-store / redaction / stats-audit modules established in P0–P3. Downstream, P6 is the **sole enabler** of the v1.4 benchmark harness and ablation ladder (spec sec 18; roadmap sec 12) — nothing in v1.2 GA consumes the traces, which is why P6 can trail GA (roadmap sec 0, sec 9 note).

**Rollback / feature-flag plan.** All trace writing sits behind `MEGASAVER_REPLAY_TRACE` (default on; illustrative — confirm in repo). Disabling it produces zero trace artifacts and a byte-identical proxy response (P6-AS10), so rollback is a flag flip with no behavioral blast radius. Trace writing is best-effort and non-blocking, mirroring the spec sec 13.4 hook safety posture: a write failure never affects the user-facing response (P6-AS14). Because P6 adds **no new tool** to `tools/list` (guardrail 2) and **forks no module** (guardrails 1/3), reverting the PR cannot break connectors or the MCP schema. Retention/rotation caps bound on-disk growth even if left enabled.

**Size estimate.** Medium — consistent with roadmap sec 1 (P6 = M) and spec sec 15 PR 7 ("medium"). The work is mostly a schema + a single read-only capture point + an offline loader/validator, all reusing existing content-store, redaction, stats/audit, and the P4 scorer; **no new ranking, storage, redaction, or audit logic**. The riskier slices are threading `trace_id` through the expandable-chunk handle for expand linking (P6-T6) and proving offline replay-readiness against the shared scorer (P6-T8 / e2e), which carry the medium rather than small sizing.

---

# Part V — Risk, QA & Release

Both files read. I have full spec and locked roadmap. Producing the three cross-cutting sections, mapping every relevant acceptance criterion.

## Consolidated Risk Register

| ID | Risk | Phase(s) | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R1 | **Public MCP schema break** — changing `tools/list` naming surface after connectors are installed breaks pinned configs (spec §5.4, §15 PR1; guardrail #2). | P0 (origin); all later phases that touch `tools/list` | Medium | Critical | Land naming mode **first** (P0, locked) before any tool ships. `MEGASAVER_TOOL_NAMING=proxy\|legacy`, default `proxy`. Snapshot test on `tools/list` output per mode as a merge-blocking gate. Legacy opt-in documented so existing connectors pin `mega_*`. Any new tool (e.g. `proxy_search_code`) registers through the naming adapter, never as a raw second entry. |
| R2 | **Shared-scorer refactor regression** — extracting context-pruner/LAMR scorer into `packages/ranking-core` (illustrative — confirm in repo) changes existing context-pack ranking behavior (spec §8; guardrail #3,#4). Single riskiest change in v1.2 (roadmap §1.1). | P4 (origin); regresses P2/P3 consumers + existing context-pruner | Medium | Critical | Characterization tests on existing context-pruner scoring captured **before** extraction (golden scores on a frozen corpus); diff must be zero. Extract against **both** consumers (compressor dispatch + search) already present — Order A guarantees this. Gate behind `MEGASAVER_ENGINE_RANKING=true` so disabling restores pre-refactor path. No second additive formula permitted — review checks single scorer call site. |
| R3 | **Hook blocks or fails the user's tool call** — PreToolUse logger throws/hangs and prevents native Read/Bash/Grep from running (spec §13.4 critical rule; guardrail — always exit 0). | P5 | Low | Critical | Hook script: metadata-only, non-blocking, best-effort, **always exit 0**; safe if `.megasaver` missing or log unwritable; wrap all I/O in catch-and-swallow. Test matrix: missing dir, read-only log, malformed env, large/slow disk — assert exit 0 and original tool unaffected in every case. Telemetry-first/best-effort posture (see Release section). Hook is opt-in via installer, never auto-injected. |
| R4 | **Fake positive savings on small output** — full wrapper costs hundreds of tokens; wrapping a small output reports a "saving" that is actually a loss (spec §11; guardrail). | P2 | High (if unguarded) | High | Passthrough rule enforced at compression time: `<1200` minimal passthrough, `1200–2000` light summary + raw, `>=2000` full compression. Audit records `passthrough`; D7-core savings metric must **not** emit positive savings for passthrough rows. Test: small fixture → audit shows `passthrough`, saved% not fabricated. Thresholds user-configurable. |
| R5 | **Stale/missing index misleads results** — index enrichment overrides or contradicts live filesystem matches (spec §9.2–9.5). | P3 | Medium | High | Live `rg` over current filesystem is **source of truth**; index is enrichment only and can never override live matches. Missing → `index_enrichment = unavailable`; stale → `skipped_stale_index` + optional `mega index build` suggestion. Never block search. Fixture tests: no-index, stale-index, post-edit-file — live results unchanged, enrichment flag correctly set. |
| R6 | **ANSI/reporter variance breaks classification** — colored output, reporter or tool-version differences cause misclassification or compressor crash (spec §10.2–10.6). | P1 (origin); P2 consumes | Medium | High | ANSI strip **before** classify/compress (pipeline non-negotiable); raw ANSI still stored for expansion. Classifier uses both command-matching and output-sniffing; returns confidence; low confidence → generic output filter fallback. Fixture corpus covers reporter/version/color variants (governed in Test & QA below). Misclassification degrades gracefully to generic filter, never errors. |
| R7 | **Low connector adoption** — Proxy Mode over MCP is opt-in, not true MITM; agents keep calling native Read/Bash/Grep (spec §6, §7). | P5 | High | Medium | Strong connector instruction blocks + agent-friendly MCP tool descriptions biasing agents to `proxy_*` (spec §6, D8). Update Claude Code, Cursor, Codex/Gemini/Aider where present. Measure adoption rate honestly; hook-based interception where installed surfaces the native-bypass gap so it can be reduced over time. |
| R8 | **Over-wrapping → negative savings** — even mid-size outputs net-cost tokens after wrapper overhead (spec §11.1). | P2 | Medium | Medium | `1200–2000` band returns light summary + raw (bounded overhead), not full wrapper. Savings metric computed as returned-vs-raw at compression time; regression test asserts net saving non-negative across the fixture corpus, including the boundary sizes 1199/1200/1999/2000. |
| R9 | **Duplicate tool-name leakage** — both `proxy_*` and `mega_*` appear in `tools/list`, wasting context and confusing the agent (spec §5.1, §20; guardrail #2). | P0 (origin); any phase registering tools (esp. P3 `proxy_search_code`) | Medium | High | Naming adapter is the only registration path; both modes call one implementation. Merge-blocking assertion: for each underlying tool exactly one name appears in `tools/list` for a given mode; no underlying tool emits two schema entries. Re-run this gate in every phase that adds/registers a tool. |
| R10 | **Claiming universal interception without hook data** — dashboard/README reports an "interception rate" denominator that can't be measured without hooks (spec §7.1, §7.3, §13.6; guardrail #5). | P5 | Medium | High | Two distinct metrics: universal **adoption rate** (`proxy_calls / known_megasaver_calls`) always; **hook-based interception** only when `.megasaver/hooks/claude-tool-calls.jsonl` exists. Missing hook → adoption only + install suggestion; never show interception. Dashboard separates the two; audit wording reviewed so no copy implies universal interception. |
| R11 | **Raw output lost / not expandable** — a compressor or passthrough path drops raw, or only stores ANSI-normalized text, defeating expansion (spec §10.2, §11; guardrail #6). | P2, P3 (origin); P6 trace references | Low | Critical | Pipeline stores **raw stdout/stderr unchanged** in content-store before ANSI strip; normalization used only for classify/compress. Every compressor and search path returns expandable chunk IDs. Raw-vs-compressed parity + expansion test (see Test & QA) is a per-phase gate. Replay trace references content-store IDs, never duplicates raw (spec §12.3). |
| R12 | **Index enrichment / search execution bypasses command policy** — `rg` runs outside the existing allowlist (spec §9.5; guardrail #3). | P3 | Low | High | `proxy_search_code` runs through the existing command policy/allowlist (reuse, not fork). Test asserts a disallowed pattern is rejected and that search uses the same policy layer as `proxy_run_command`. |
| R13 | **Replay trace privacy leak / raw duplication** — trace logs raw contents instead of referencing content IDs (spec §12.3, §13.4). | P6 | Low | High | Trace stores content-store/chunk IDs only; no raw beyond what content-store already holds. Redaction pipeline reused. Test: trace contains no raw payloads, only IDs; passthrough decisions get minimal-metadata traces. |
| R14 | **D7-core metric drift after P2→P5 split** — savings counts computed in P2 diverge from adoption/interception surfaced in P5, double-counting or mismatching on one dashboard (roadmap §1.1 split). | P2, P5 | Medium | Medium | Single audit/stats source of truth (reuse existing stats/audit). P2 writes raw/returned tokens, saved%, passthrough/category/compressor counts; P5 only adds adoption + interception and surfaces P2 numbers on the same dashboard — no recomputation. Reconciliation test: dashboard totals equal sum of per-call audit rows. |

---

## Test & QA Strategy

### v1.2 Testing Pyramid

| Tier | Scope | What it covers (per phase) | Runs |
|---|---|---|---|
| **Unit** | Pure functions, no I/O | ANSI strip; classifier command-match + output-sniff scoring + confidence (P1); compressor keep/collapse rules (P2); passthrough threshold band logic (P2); signal normalization to `[0,1]` and `final_score = 0.70·base + 0.15·memory + 0.15·failure` (P4); naming-adapter map (P0); hook log-line serializer (P5); trace serializer → content IDs (P6). | Every commit. |
| **Fixture** | Real captured tool output → expected classification/compression | Vitest/tsc classification correctness; compressed output retains required fields; raw-vs-compressed parity; reporter/version/ANSI variance (P1/P2). Governed corpus below. | Every commit; merge-blocking. |
| **Integration** | Full pipeline through reused components | `raw → store raw (content-store) → strip ANSI → classify → compress → return` with real content-store/audit/policy/redaction (P1–P3); `proxy_search_code` rg-first + index enrichment states (P3); shared-scorer call from both compressor dispatch and search (P4); hook-log ingestion → metrics (P5); trace write + expand-event linking (P6). | Per PR; merge-blocking for the phase. |
| **E2E** | MCP surface as an agent sees it | `tools/list` exact contents per naming mode (P0); end-to-end proxy tool call returns compact output + expandable chunk IDs + savings; `proxy_stats` shows adoption (and interception only when hook log present); legacy-mode install still works (P5). | Per PR touching MCP surface; pre-GA full run. |

### Fixture Corpus Governance

Corpus lives under a versioned fixtures dir (illustrative — confirm in repo) with one subdir per category. Each fixture is a triple: **raw bytes (ANSI preserved)**, **provenance metadata** (tool, version, reporter, color on/off, captured-at), and **expected classification + key compressed assertions**. Governance rules:

- **Vitest variants (spec §10.5):** plain; ANSI-colored; default reporter; verbose reporter; **≥2 Vitest version/output variants** where available. Each tagged with reporter + version in provenance.
- **TypeScript variants:** plain `tsc`; ANSI-colored `tsc --pretty`. Both `error TS…` single-error and multi-file/`Found X errors` shapes.
- **Mixed stdout/stderr** command output; **unknown** command output (must fall back to generic, not error).
- **Boundary sizes:** fixtures sized at 1199/1200/1999/2000 raw tokens to pin passthrough bands (R4/R8).
- **Provenance required** so a reporter/version bump that changes output is a deliberate corpus update (new fixture added, old kept) — never a silent overwrite. Adding a tool/reporter/version variant requires adding a fixture before the classifier/compressor is allowed to claim support.
- **ANSI-preservation invariant:** every fixture keeps original escape codes; the strip step is exercised inside tests, never pre-applied to stored fixtures (protects R6/R11).
- Corpus is the shared input for P1 classification tests and P2 compression tests, so a single variance addition is exercised by both.

### Per-Phase Merge-Blocking Regression Gates

| Phase | Gate (must be green to merge) |
|---|---|
| **P0** | `tools/list` snapshot: proxy-mode shows `proxy_*` only; legacy-mode shows `mega_*` only; **no underlying tool emits two entries** (R1/R9); behavior identical across modes. |
| **P1** | All corpus fixtures classify correctly incl. colored/reporter/version variants; unknown → generic fallback; confidence recorded; ANSI stripped before classify; **raw ANSI still retrievable from content-store**. |
| **P2** | Per compressor: required keep-fields present, collapse-fields collapsed, exit code preserved; raw-vs-compressed parity + expansion (below); passthrough bands correct at boundaries; **D7-core savings recorded, no fake positive savings on passthrough** (R4/R8/R14). |
| **P3** | Works no-index / stale-index / post-edit; enrichment never overrides live; enrichment flag correct; grouped-by-file; raw stored + expandable; **search respects existing command policy** (R12). |
| **P4** | Shared scorer reused (single call site, no second engine — R2); signals normalized; explanation lists contributing signals; flag fully disables; **context-pruner characterization golden unchanged**. |
| **P5** | Adoption metric present always; interception present **only** when hook log exists; missing hook → adoption + install suggestion, stats don't break; **hook always exits 0** under fault matrix (R3/R10); Setup Doctor detects installed/missing. |
| **P6** | Trace written for compressed + passthrough responses; references content IDs only, **no raw duplication** (R13); replay reconstructs ranking offline; supports ablation ladder. |

Every PR re-runs the **cross-cutting guardrail gates** (no `packages/proxy` duplication; no duplicate tool names; raw always stored + expandable; honest-metrics copy check) regardless of phase.

### Raw-vs-Compressed Parity and Expansion Verification

- **Parity:** for each compression fixture, assert every chunk ID referenced in compressed output resolves in content-store, and that concatenating all chunks reconstructs the **raw stored output byte-for-byte** (raw is stored pre-ANSI-strip, so reconstruction equals original including escape codes). This proves nothing is silently dropped (R11).
- **Coverage:** assert the set of required keep-fields (failing test names/assertions/stack/paths/lines/summary/exit code for Vitest; path/line-col/TS-code/message/grouping/top-files for tsc) all appear either inline or as a referenced expandable chunk — none lost in compression.
- **Expansion:** call `proxy_expand_chunk` on omitted chunk IDs and assert it returns the original raw segment; assert audit logs an expand event and (P6) the trace links it back.
- **Passthrough parity:** small-output fixtures assert returned body contains full raw and audit row is `passthrough` with no positive saved%.

---

## Release & Rollback Strategy

### Feature Flags

| Flag | Values / Default | Controls | Failure-safe default |
|---|---|---|---|
| `MEGASAVER_TOOL_NAMING` | `proxy` \| `legacy`, **default `proxy`** | Which name set `tools/list` exposes; both call one implementation (spec §5.2). | `legacy` is the compatibility escape hatch for installed connectors — flipping to legacy restores pre-v1.2 `mega_*` surface without code change. |
| `MEGASAVER_ENGINE_RANKING` | `true` \| `false` | Engine-aware (memory + failure) ranking via shared scorer (spec §8.4, D6). | `false` → falls back to base BM25/output-relevance only; disables the riskiest refactor path (R2) at runtime. |

Supporting (spec-defined, not new top-level flags): passthrough thresholds (`passthrough_threshold_tokens=1200`, `hard_wrap_threshold_tokens=2000`) are **user-configurable** so over-wrapping can be tuned/disabled per install (spec §11.4). Hook telemetry is gated by **presence of the installed hook + log file**, not a flag (spec §13.6).

### Staged Rollout with Legacy Opt-In

1. **P0 ships naming mode first.** New installs default to `proxy`. **Existing connectors** are documented to pin `MEGASAVER_TOOL_NAMING=legacy` before upgrading, preserving their `mega_*` bindings until they migrate (spec §5.4, §15 PR1). This is the primary backward-compat lever.
2. **Compression (P2) ships self-proving** — savings visible per call before search/ranking land, so rollout can be validated on real outputs early.
3. **Engine ranking (P4) ships behind `MEGASAVER_ENGINE_RANKING`**, default-on for new but flippable off instantly if the shared-scorer refactor regresses context packs (R2).
4. **Hooks (P5) are opt-in** via `mega hooks install claude-code`; never auto-installed. Interception metrics appear only after explicit install.
5. **GA after P0–P5 exit gates pass; P6 may trail GA** (roadmap §0/§9).

### Per-Phase Rollback Path

| Phase | Rollback |
|---|---|
| **P0** | Set `MEGASAVER_TOOL_NAMING=legacy` to restore `mega_*` surface (no redeploy). Full revert: drop naming adapter; implementations unchanged underneath. |
| **P1** | Low-confidence/unknown already routes to generic output filter; disabling classifier → all output takes generic filter path (pre-v1.2 behavior). |
| **P2** | Disable per-category compressor dispatch → outputs fall through to generic filter / passthrough; raw always intact in content-store, so no data loss. Thresholds can be raised to force passthrough everywhere. |
| **P3** | `proxy_search_code` is additive; deregister the tool (via naming adapter) to remove it from `tools/list` — no impact on read/run/expand tools. |
| **P4** | `MEGASAVER_ENGINE_RANKING=false` → base relevance only; shared scorer still callable but engine signals dropped. Refactor revert restores in-place context-pruner scorer (characterization golden proves equivalence). |
| **P5** | Hook is opt-in + best-effort: uninstall hook or delete log → metrics silently drop to adoption-only; **stats never break** (spec §13.6/§13.7). Connector instruction blocks are docs/config — revertible without code. |
| **P6** | Trace writing is append-only telemetry; disable the writer → no functional impact on proxy responses (trace is for v1.4, not runtime behavior). |

### Telemetry-First / Best-Effort Posture for the Claude Code Hook

The hook is **pure telemetry, never control flow** (spec §13.4, guardrail #5). Posture:

- Hook logs metadata-only (`Read/Bash/Grep/Glob/LS`) to `.megasaver/hooks/claude-tool-calls.jsonl`; **never logs raw file contents**.
- **Always exits 0**, non-blocking, fast; safe if `.megasaver` is missing or the log is unwritable; **must never prevent the original tool from running** (the critical rule, R3).
- Failure mode is silent degradation: a broken/absent hook simply means no interception metric — adoption metrics and all proxy tools keep working. Missing hook surfaces "Proxy adoption metrics only / Run: `mega hooks install claude-code`" (spec §13.6).
- Setup Doctor (CLI + GUI) detects installed/missing hook so users can see telemetry status without it ever being a hard dependency (spec §13.7).

### Disabling Each New Surface Without Breaking Existing Installs

| New surface | Disable mechanism | Existing-install safety |
|---|---|---|
| Proxy tool names | `MEGASAVER_TOOL_NAMING=legacy` | Restores `mega_*`; connectors keep working. |
| Output classifier | Route all to generic filter | Equivalent to pre-v1.2 generic pruning. |
| Vitest/tsc compressors | Disable dispatch / raise thresholds → passthrough | Raw always in content-store; no loss. |
| `proxy_search_code` | Deregister tool from `tools/list` | Additive tool; other tools unaffected. |
| Engine ranking | `MEGASAVER_ENGINE_RANKING=false` | Base relevance; context packs unchanged. |
| Hook telemetry | Don't install / uninstall / delete log | Stats fall back to adoption-only; nothing breaks. |
| Replay trace | Disable writer | No runtime effect; append-only telemetry. |

Net: every v1.2 surface degrades to a documented pre-v1.2 or additive-removed state via a flag, a threshold, tool deregistration, or simply not installing the hook — **no new surface is a hard dependency of the existing system**, honoring guardrail #1 (evolve, don't rebuild) and the locked phase ordering.

---

All sections returned above in order: Consolidated Risk Register, Test & QA Strategy, Release & Rollback Strategy. No files written; phase numbering/ordering preserved as locked. Inferred module paths (`packages/ranking-core`, `packages/context-pruner/scoring`, fixtures dir, `.claude` connector configs) marked illustrative — confirm in repo.

Source files used:
- `/Users/halitozger/Desktop/MegaSaver_Proxy_Mode_v1.2_Design_Spec_Commit_Ready.md`
- `/Users/halitozger/Desktop/MegaSaver_Proxy_Mode_v1.2_Roadmap.md`

---

# Part VI — GA Definition of Done & Beyond v1.2

## v1.2 GA Definition of Done

Ship v1.2 GA when all hold:

- [ ] Naming mode exists, defaults to proxy; legacy exposes `mega_*` with no duplicate proxy names. (P0)
- [ ] Output classifier exists with Vitest + tsc fixtures; ANSI strip before classify/compress. (P1)
- [ ] Vitest compressor works; TypeScript compressor works; small-output passthrough works. (P2)
- [ ] Raw output storage reuses content-store; policy reuses existing allowlist. (P1–P3)
- [ ] Per-call savings/passthrough metrics recorded at compression time. (P2)
- [ ] `proxy_search_code` exists, rg-first, works without index, works with stale index. (P3)
- [ ] Engine-aware ranking behind flag with only memory/failure boosts; no duplicate LAMR scoring. (P4)
- [ ] Proxy metrics distinguish adoption from hook-based interception. (P5)
- [ ] Claude Code hook installer exists, or explicitly documented as not yet available. (P5)
- [ ] Connector instructions prefer proxy tools; README avoids "DFMT-style" headline. (P5)
- [ ] Replay traces recorded for future v1.4 ablations. (P6 — required for v1.4, recommended for GA)

---

## Beyond v1.2 (parking lot)

**v1.3 (production-grade):** repo-index/dependency/recent-edit/rule signals; ESLint, git-diff, Next.js build, Jest, Playwright compressors; rich expand policies; auto budget; connector-specific adoption tuning; `proxy_search_code` index/hybrid backends.

**v1.4 (proof):** benchmark harness + public report; ablation ladder (baseline → +memory → +failure → +repo index → +dependency → full ranking); Proof-of-Done; proof-aware memory writes. Powered by P6 replay traces.

**The proof that matters:** ablation benchmark showing memory-aware ranking beats generic output filtering.

---

# Part VII — Completeness Audit & Reconciliation

This roadmap was assembled by a 17-agent fan-out (7 phases × expand→harden, 2 cross-cutting, 1 adversarial completeness critic) over the v1.2 spec as source of truth.

## Audit Verdict

- **Coverage:** PASS — complete
- **Blockers:** 0
- **Verdict:** PASS (coverage complete). Every spec Section 14 deliverable D1–D10 and every Section 16 GA-list item is mapped to a phase exit gate and at least one acceptance scenario across the assembled content: D1→P0, D2→P1, D3+D4+D7-core→P2, D5→P3, D6→P4, D7-rest+D8+D9→P5, D10→P6. The locked ordering decisions are honored throughout — search (P3) is consistently placed before ranking (P4), P3's only hard dep is P0 (parallel to P1/P2), and the D7 split (D7-core pulled into P2, D7-rest in P5) is applied consistently with no double-counting (P5 explicitly surfaces, never recomputes, P2's savings). No phase proposes a parallel proxy stack or packages/proxy; the shared scorer is extracted once (single-scorer guard tests in P4 and P6 replay), so there is no second ranking engine. No duplicate proxy_*+mega_* listing is introduced; proxy_search_code is correctly a new tool with no mega_* twin in either mode, and P4/P5/P6 add zero MCP tools. Honesty constraints hold: P0/P1 explicitly add no savings/interception claim; passthrough records 0 (no fake positive); interception is gated on hook-log presence with the verbatim sec 13.6 fallback string; raw is always stored before ANSI strip and remains expandable, with ANSI-normalized copies used only for classify/compress. All inferred module paths and the stats entry-point name are marked illustrative. The findings above are all minor internal-consistency nits (light-summary savedPct rule disagreement between P2 and P6; ENGINE_RANKING default disagreement between P4 and the Release section; inferred hook category vocabulary; path-label unification) — none are merge blockers and none leave a spec acceptance criterion uncovered. Recommend reconciling the two cross-phase contradictions (light-band savings, ranking default) before commit so the phases do not ship mutually inconsistent rules.

### Spec criteria not covered
- None. Every spec §14 deliverable (D1–D10) and §16 GA-list item maps to a phase exit gate + ≥1 acceptance scenario.

## Reconciliation Decisions (authoritative — override any inline contradiction)

The critic surfaced two genuine cross-phase contradictions. These rulings are authoritative and override conflicting inline text in the phase sections:

1. **Light-summary savings reporting (P2 ↔ P6).** The light-summary band (`1200 ≤ raw_tokens < 2000`) records the **actual measured saved %, clamped to ≥ 0** — never a fabricated positive (spec §11.4). Only the *minimal passthrough* band (`< 1200`) hard-codes `saved % = 0`. P2-T8 and P6-T5 follow this single rule.
2. **`MEGASAVER_ENGINE_RANKING` default (P4 ↔ Release).** Default = **on (`true`)**, flippable off — consistent with spec §8.4 examples and the product claim that the memory-aware differentiator be visible. Any P4 "recommended default false" note is overridden.

The remaining 3 nits are non-contradictions (informational), each already marked "(illustrative — confirm in repo)": optional single-run cross-mode `tools/list` invariant assertion (P0); confirm the real PreToolUse `category` vocabulary for Bash/Grep/Glob/LS before shipping (P5); unify the illustrative connector-doc path label (P5 ↔ Risk Register).

## Full Findings (all minor)

1. **MINOR** — _P0 — Out of Scope / Estimate (proxy_search_code stub + 'P3 unblocks' wording) vs locked dependency graph_
   - Problem: P0 states 'both P1 and P3 depend on P0 (dependency graph: P0 → P1, P0 → P3)' and the P0 Dependencies section says the stub 'is the seam P3 fills' — consistent. But P0-T5/Module Touchpoints describe the stub handler as writing 'no content-store/audit side effects,' while later (Exit Gate) it is 'callable but inert.' This is internally consistent; the only nit is that nowhere in P0 is it pinned that the stub must ALSO be absent from legacy mode's tools/list count invariant test as a positive assertion across BOTH modes simultaneously in one snapshot. It is covered by AS7 + golden snapshots, so this is informational only, not a coverage gap.
   - Fix: No change required. Optionally add one explicit assertion that a single test boots both modes and confirms search_code count == 1 (proxy) and == 0 (legacy) in the same run to lock the cross-mode invariant.

2. **MINOR** — _P2 Interfaces — savedPct rule vs spec sec 11.4 / honesty; light-summary band_
   - Problem: P2 savings rule records savedPct = 0 on ANY passthrough decision including light (passthrough_light). The cross-cutting P6 section (P6-T5 / P6-AS3) instead says light_summary reports its REAL (small) saved %, never 0. These two phases disagree on whether the light-summary band reports 0 or a real small saving. Spec sec 11.4 only forbids 'fake positive savings'; it does not mandate light-band reports a real positive. The contradiction is between P2 (light → 0) and P6 (light → real small %).
   - Fix: Reconcile: pick one rule for the light-summary band and state it identically in P2-T8 and P6-T5. Safest honest choice consistent with both: light band records the ACTUAL measured saved % (which may be ~0 or slightly positive/negative-clamped-to-0), never a fabricated positive. Update P2 savings rule so only the minimal passthrough is hard-coded to 0, and light uses clamped real savings to match P6-AS3.

3. **MINOR** — _P5 hook log 'category' field vs spec sec 13.3_
   - Problem: P5 invents category values eligible_command / eligible_search and the P5 contract enumerates proxy_calls_by_type with proxy_expand_chunk but the hook-eligibility tool set is Read/Bash/Grep/Glob/LS (sec 13.3). The assembled P5 already flags the extra category tags as inferred ('illustrative — confirm in repo') and treats category as opaque, which is correct. No spec violation. Listed only because the spec shows ONLY 'eligible_read' verbatim and a reviewer must confirm the repo's real category vocabulary before shipping.
   - Fix: Keep the opaque-category handling. Before implementation, confirm the actual PreToolUse category vocabulary emitted for Bash/Grep/Glob/LS in the repo and replace the inferred eligible_command/eligible_search labels with the real ones.

4. **MINOR** — _P4 default flag value vs spec — MEGASAVER_ENGINE_RANKING_
   - Problem: Spec sec 8.4 / Deliverable 6 write the flag as 'MEGASAVER_ENGINE_RANKING=true' (shown enabled in examples). The P4 Interfaces section recommends default `false` ('opt-in differentiator'), while the cross-cutting Release section says 'default-on for new but flippable off.' P4-internal text and the Release section disagree on the default (false vs on). Spec does not explicitly pin the default boolean, so neither violates an acceptance criterion, but the roadmap content contradicts itself.
   - Fix: Pick one default and state it identically in the P4 Interfaces block and the Release & Rollback section (both marked 'illustrative — confirm in repo'). Given spec examples show =true and the product claim depends on the differentiator being visible, default-on is the more defensible choice; if chosen, update P4's 'Recommended default false' note to match.

5. **MINOR** — _Cross-cutting Risk Register R12 / Test & QA — illustrative path '.claude connector configs'_
   - Problem: The Risk Register closing note lists '.claude connector configs' among inferred paths, but the connector-config touchpoints elsewhere are described as docs/connectors/ and connector instruction files. Minor path-label inconsistency; both are marked illustrative. No spec impact.
   - Fix: Unify the illustrative connector-path label across the Risk Register note and P5 Module Touchpoints to one placeholder (e.g. 'connector instruction docs (illustrative — confirm in repo)').
