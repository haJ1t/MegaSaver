---
title: Plan — publish real `inputSchema` per MCP tool
spec: docs/superpowers/specs/2026-07-25-publish-tool-input-schemas-design.md
risk: HIGH
created: 2026-07-25
---

# Plan — publish tool input schemas

## Task 1 — RED: coverage + contract tests

`packages/mcp-bridge/test/server.e2e.test.ts` (real MCP client harness
already present):

- every tool in `listTools()` has `inputSchema.type === "object"` AND a
  non-empty `properties` object → fails today (all bare).
- every published schema has `additionalProperties === false`.
- `proxy_search_code` advertises `required: ["query","sessionId"]` and
  `max_results` as `{type:"integer"}`.
- published schemas are identical in `proxy` and `legacy` naming modes.
- advertised-vs-enforced: calling `proxy_search_code` without `query`
  is rejected, matching its advertised `required`.

**Verify:** `pnpm --filter @megasaver/mcp-bridge test` red on coverage.

## Task 2 — GREEN: export the schemas

Add `export` to the input-schema const in each tool module (31 direct +
`context-pruning`'s shared one). Local names unchanged; the record
aliases on import.

**Verify:** `pnpm --filter @megasaver/mcp-bridge typecheck`.

## Task 3 — GREEN: the typed record

New `src/tool-schemas.ts`:
`export const TOOL_INPUT_SCHEMAS: Record<McpToolName, z.ZodTypeAny>`.
`Record<McpToolName, …>` makes a missing tool a compile error.

Mapping is the one derived mechanically from the dispatch switch (spec
§1.1), not hand-guessed.

**Verify:** typecheck fails if any id is omitted (assert by temporarily
deleting one entry).

## Task 4 — GREEN: convert + publish

`server.ts`: build a `Map<McpToolName, JsonSchema>` once at module load
via `zodToJsonSchema(s, { $refStrategy: "none", target: "jsonSchema7" })`,
stripping `$schema`. Publish it from the `ListToolsRequestSchema`
handler.

**Verify:** package tests green.

## Task 5 — docs + release

- `.changeset/publish-tool-input-schemas.md` — minor.
- `wiki/entities/mcp-bridge.md` — new section + correct the stale
  "26 tools" to 35.
- `wiki/log.md` entry.

**Verify:** `pnpm verify` (run `biome check --write` on new/edited files
FIRST — three format-only verify failures this session).

## Task 6 — review (HIGH, §12)

`critic`, fresh context. Forbid working-tree git commands; snapshot
first, diff against snapshot at the end. Run verify AFTER the review,
never concurrently.
