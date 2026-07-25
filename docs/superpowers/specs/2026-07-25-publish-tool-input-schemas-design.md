---
title: Publish real `inputSchema` for every MCP tool
status: proposed
risk: HIGH
created: 2026-07-25
package: "@megasaver/mcp-bridge"
found-by: 2026-07-25 inert-MCP-inputs fix
---

# Publish real `inputSchema` per tool

> HIGH risk — public agent-facing contract (`CLAUDE.md` §12). Publishing
> a schema is a promise; anything advertised must be honored.

## §1 Problem

`server.ts:282` publishes `inputSchema: { type: "object" as const }` for
every tool in `tools/list`. No properties, types, required list, or
bounds are advertised for anything. Agents must infer parameter names
from the prose description — which is how `max_results` came to be
passed-and-ignored (`2026-07-25-inert-mcp-inputs-design.md` §1.1).

Every tool already has a precise Zod schema; it is simply never
surfaced.

### §1.1 Correction: 35 tools, not 26

The incoming report said "every one of the 26 tools". `TOOL_DEFS` holds
**35**. The 26 figure is stale (25 ContextOps tools + `proxy_search_code`)
and is repeated in `wiki/entities/mcp-bridge.md`; both are corrected.

Derived mechanically from the dispatch switch → handler → the schema each
handler `safeParse`s, rather than by hand: 31 tools name a schema
directly; the 4 `context-pruning` tools (`get_relevant_context`,
`get_relevant_code_blocks`, `explain_context_selection`,
`get_context_budget_report`) share that module's single `inputSchema`
through a common helper.

## §2 Decisions

### §2.1 Converter — reuse `zod-to-json-schema`

Already resolved in the lockfile at 3.25.2 as a dependency of
`@modelcontextprotocol/sdk`, against our exact `zod@3.25.76`. Declaring
it a direct dependency of `@megasaver/mcp-bridge` downloaded and added
**zero** packages (`pnpm add` reported `downloaded 0, added 0`).

A hand-rolled converter was considered and rejected: the schemas in play
use `.strict()`, `.optional()`, `.default()`, `.brand()`, `min/max`,
`int`, enums, literals, unions, arrays, and nested objects. Hand-rolling
that correctly is more code and more drift risk than a library already
on disk, maintained by the MCP SDK's own author chain.

Verified empirically before committing to the design:

| input | emitted |
|---|---|
| `.strict()` | `additionalProperties: false` |
| `.optional()` | omitted from `required` |
| `z.string().min(1)` | `{type:"string", minLength:1}` |
| `z.number().int().positive()` | `{type:"integer", exclusiveMinimum:0}` |
| `.brand("ProjectId")` | unwraps to the base type |
| `.default("a")` | `default: "a"` |

Options: `{ $refStrategy: "none", target: "jsonSchema7" }`. `$refStrategy:
"none"` guarantees no `$ref`/`definitions` can appear for a self-reusing
schema — MCP clients are not required to resolve refs. The emitted
`$schema` draft key is stripped: it is metadata, not contract, and it
would repeat a URL across 35 listings.

### §2.2 Exhaustive mapping via a typed record

A new `src/tool-schemas.ts` holds
`TOOL_INPUT_SCHEMAS: Record<McpToolName, z.ZodTypeAny>`.

`Record<McpToolName, …>` makes completeness a **compile-time** guarantee:
adding a tool to `McpToolName` without a schema fails `tsc`. That is
strictly better than a runtime test, and better than adding an `input`
field to each of 35 `TOOL_DEFS` entries inline, which has no such check.

Each entry references **the same schema object the handler parses with**,
so the advertised contract and the enforced contract cannot drift — they
are one value. The residual risk is mapping the right id to the wrong
schema (e.g. `project-rules` exports two); §3.2 covers it.

### §2.3 Honesty rules

- **Advertise only what Zod enforces.** A `.default()` in a schema is
  applied by `safeParse`, so publishing it is honest. Code-level
  fallbacks that are *not* in the schema (e.g. `max_tokens ??
  MAX_BYTES_CEILING` in `search-code.ts:192`) stay unadvertised — the
  schema says "optional", the code picks a fallback, and no default is
  claimed.
- **No invented bounds.** Nothing is added to a Zod schema to make the
  published output prettier. If a bound is not enforced today it is not
  advertised. (Notably `max_results` is published without the roadmap's
  `maximum: 500` / `default: 50`, because neither is enforced — see
  `2026-07-25-inert-mcp-inputs-design.md` §3.2.)
- **Naming mode is unaffected.** `inputSchema` describes *arguments*; it
  contains no tool identifier, so `exposedToolName` /
  `MEGASAVER_TOOL_NAMING` cannot leak an internal id through it. Asserted
  by a test rather than by inspection.

## §3 Design

### §3.1 Wiring

- Export the input schema from each tool module (local names kept; the
  record aliases at import).
- `tool-schemas.ts` maps every `McpToolName` to its schema.
- `server.ts` converts once at module load — a `Map<McpToolName, object>`
  built from `TOOL_INPUT_SCHEMAS` — not per `tools/list` request.
- `ListToolsRequestSchema` handler publishes the converted schema.

### §3.2 Tests

- Every published tool has `type: "object"` and a `properties` object —
  no tool may regress to the bare `{type:"object"}`.
- Every published schema carries `additionalProperties: false`, matching
  the `.strict()` on every input schema.
- Spot-check the contract end-to-end through the real MCP client
  (`server.e2e.test.ts` already has the harness): `proxy_search_code`
  advertises `query`/`sessionId` as required and `max_results` as an
  integer, and calling it without `query` is rejected — the advertised
  requirement and the enforced one agree.
- The published schema is byte-identical in both naming modes (no
  internal id leaks).
- A mis-wiring guard: for a sample of tools, a payload the *advertised*
  schema declares invalid is rejected by the *handler*.

## §4 Blast radius

Additive for agents: a tool that previously advertised nothing now
advertises its real contract. No handler behaviour changes; validation is
unchanged in every case (the same Zod object does the same `safeParse`).

Risk worth naming: agents that previously sent extra junk keys and got
away with it were **already** being rejected by `.strict()` — publishing
`additionalProperties: false` makes that visible rather than new.

`@megasaver/mcp-bridge`: **minor**. Purely additive to the wire contract;
no input is newly rejected and no output shape changes. (Contrast the
sibling `around` removal, which was major because it removed an accepted
input.)

## §5 Alternatives considered

- **Hand-rolled converter — REJECTED.** §2.1: more code than the
  already-present library, across ~10 Zod constructs.
- **`input` field on each of 35 `TOOL_DEFS` entries — REJECTED.** No
  compile-time completeness check, and 35 inline edits to the file that
  is hardest to review.
- **Publish schemas for only the high-traffic tools — REJECTED.** Partial
  coverage reproduces the original defect: an agent cannot tell an
  unadvertised tool from an argument-less one.
- **Also add the roadmap's `maximum: 500` / `default: 50` to
  `max_results` — REJECTED.** §2.3. Advertising an unenforced bound is
  the exact failure this batch exists to remove.

## §6 Definition of Done

1. TDD, red before green.
2. All 35 tools publish a real schema; none left as bare
   `{type:"object"}`.
3. Completeness is compile-time enforced (`Record<McpToolName, …>`).
4. Naming-mode invariance asserted.
5. Advertised-vs-enforced agreement asserted end-to-end.
6. `pnpm verify` green.
7. `critic` pass, fresh context.
8. Changeset (minor), wiki entity (including the 26→35 correction),
   `log.md`.
