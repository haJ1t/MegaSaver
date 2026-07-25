---
title: Inert MCP tool inputs — honor `max_results`, drop `around`
status: proposed
risk: HIGH
created: 2026-07-25
package: "@megasaver/mcp-bridge"
sibling: docs/superpowers/specs/2026-07-25-deny-write-honest-rejection-design.md
builds-on: docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
---

# Inert MCP tool inputs

> HIGH risk — agent-facing public tool input surface (`CLAUDE.md` §12,
> "public CLI flags" class). Same defect class as the `deny.write`
> finding, different package: a caller-settable key that is validated
> and then does nothing.

## §1 Problem

Two `.strict()` MCP tool schemas accept a key no code reads:

| key | site | consumed? |
|---|---|---|
| `max_results` | `packages/mcp-bridge/src/tools/search-code.ts:25` | never — `handleSearchCode` destructures `{query, task, sessionId, max_tokens}`; `shapeResult` returns every grouped file |
| `around` | `packages/mcp-bridge/src/tools/fetch-chunk.ts:19` | never — line 37 destructures `{chunkSetId, chunkId}` |

Because both schemas are `.strict()`, these are among the very few
keys a caller can pass **without** an error. Every other unknown key
fails loud; these two are accepted and dropped. An agent asking for
`max_results: 10` silently receives every match.

### §1.1 Correction to the incoming report

The finding stated `max_results` is "published to agents as
`{minimum:1, maximum:500, default:50}`" citing
`docs/superpowers/plans/2026-06-12-proxy-mode-v1.2-roadmap.md:890`.
That line is an **unimplemented plan**, not shipped contract.
`packages/mcp-bridge/src/server.ts:282` publishes
`inputSchema: { type: "object" as const }` for *every* tool — no
properties, no bounds, no defaults are advertised for any input.

This lowers exposure (no agent is told the key exists) but does not
remove the defect: an agent that infers `max_results` from priors, from
the roadmap doc, or from the tool description gets silent
full-output. It also means there is **no published default to honor** —
see §3.2.

### §1.2 Why the daemon path does not change the fix

The report noted the daemon's `searchRequestSchema`
(`packages/daemon/src/handlers.ts:208-221`) omits `max_results`, "so
forwarding drops it too". Confirmed, but irrelevant to where the fix
goes: `handleSearchCode` forwards to `/exec-registry` with
`{sessionId, command:"grep", args, intent, maxBytes}`, and **both** the
daemon and in-process branches funnel their `ExecResult` through the
local `shapeResult` (`search-code.ts:249` and `:251`). `shapeResult` is
therefore a single chokepoint covering both paths, and the daemon
schema needs no change.

## §2 Decision

- **`max_results` → honor it (option a).** It is a genuine cap: BM25
  re-ranking (`enrich`, `search-code.ts:136`) already orders files by
  relevance, so "top N files" is meaningful rather than arbitrary
  truncation. The v1.2 spec asked for exactly this — plan task P3-T8:
  "Within `max_results`/`max_tokens` budget select top files/snippets …
  list `omitted` with file/match counts and expandable chunk IDs" — and
  the design doc lists "omitted low-value matches" as a required output
  (`2026-06-12-proxy-mode-v1.2-design.md:949`). Neither shipped.
- **`around` → remove it from the schema (option b).** It is not an
  ignored parameter of existing behavior; it is an **unbuilt feature**.
  Honoring it means fetching neighbouring chunks — chunk ordering,
  bounds, and a changed result shape — which is its own spec, not a
  rider here. Removing it makes `.strict()` reject it loudly.

## §3 Design

### §3.1 `max_results` — cap after ranking, report the omission

`shapeResult` gains a `maxResults?: number` parameter, threaded from
both call sites. The slice runs **after** `enrich`, so the retained
files are the highest-ranked ones, not the first N grep emitted.

`SearchCodeResult` gains:

```ts
omitted?: { files: number; matches: number };
```

Present only when the cap actually dropped something. **A silent cap is
the defect we are fixing** — a truncated result that looks complete is
worse than an ignored parameter, because the agent acts on it. Mega
Saver's stated principle is that we never strip what the model needs to
decide, so the count of dropped files and their matches is reported,
and the full raw grep output remains retrievable through the
`chunkSetId` already on the result. Truncation is therefore lossless,
not evidence destruction.

### §3.2 No invented default

`max_results` stays optional with **no default**: absent ⇒ uncapped,
exactly today's behavior. The roadmap's `default: 50` is not adopted.
Adopting it would silently truncate every existing caller's results
overnight — introducing the very "looks complete but isn't" failure
this change exists to prevent, on callers who never asked for a cap.

No `.max(500)` bound is added either. An out-of-range value is already
harmless: `max_results` larger than the file count caps nothing, which
is identical to today. A rejection nobody needs is not worth the
surface.

### §3.3 `around` — removed

Deleted from `fetchChunkInputSchema`. `.strict()` then rejects it, and
zod's own message names the key ("Unrecognized key(s) in object:
'around'"), which reaches the caller verbatim via
`McpBridgeError("validation_failed", parsed.error.message)`
(`fetch-chunk.ts:35`).

Deliberately NOT given the custom named-message treatment that
`deny.write` received. That machinery earned its keep on a *security*
key, where silence means false protection and the operator must be told
the key is real-but-unenforced. `around` is a convenience parameter on
a read tool; zod naming the key is already actionable, and building
issue-path inspection for it would be ceremony.

## §4 Blast radius

- `max_results`: strictly additive. Callers that never sent it see
  byte-identical results (`omitted` is absent, not `{files:0}`).
  Callers that sent it and were ignored now get what they asked for —
  the point of the change.
- `around`: breaking for any caller sending it. No such caller exists
  in this repo (the key appears at exactly one line, its own schema
  declaration), and it never did anything, so nothing is lost.
- `SearchCodeResult` gains an optional field — additive for consumers.

`@megasaver/mcp-bridge`: **major**. Revised from an initial "minor" on
the `critic`'s objection, which was right: removing an accepted input
from a published tool schema on a post-1.0 package (1.3.0) is breaking
regardless of the input having been inert. "It was already broken" is
not a semver exemption, and the sibling `deny.write` rejection — the
same shape, a previously-accepted input now rejected — was already
classified major. The practical blast radius stays near zero.

## §5 Alternatives considered

- **Reject `max_results` (option b) — REJECTED.** It is a real,
  useful cap with a ranking that makes it meaningful and a spec that
  asked for it. Rejecting a good parameter to avoid implementing 3
  lines is the wrong trade; `deny.write` differed because implementing
  *it* meant building a whole write-gate subsystem.
- **Document both (option c) — REJECTED.** Same reasoning as the
  `deny.write` decision: no agent reads design docs before composing a
  tool call, and the inert accept stays.
- **Honor `around` too — REJECTED.** Unbuilt feature, own spec. See §2.
- **Cap silently, no `omitted` field — REJECTED.** Trades an ignored
  parameter for a misleading result. Strictly worse.
- **Publish real `inputSchema` properties for all tools — out of
  scope.** `server.ts:282` advertising `{type:"object"}` for 26 tools is
  a genuine and much larger DX gap; it deserves its own spec and is
  filed separately rather than smuggled in here.

## §6 Definition of Done

1. TDD, red before green.
2. `max_results` caps the file list, applied after BM25 ranking
   (asserted by ordering, not just length).
3. `omitted` reports dropped file and match counts; absent when nothing
   was dropped.
4. Absent `max_results` ⇒ byte-identical result to today.
5. The cap applies on the daemon-forward path as well as in-process.
6. `around` ⇒ `validation_failed` naming the key.
7. `pnpm verify` green.
8. `critic` + `code-reviewer` pass, fresh context.
9. Changeset (minor), wiki entity update, `log.md` entry.
