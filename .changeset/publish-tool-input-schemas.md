---
"@megasaver/mcp-bridge": minor
---

Publish a real `inputSchema` for every MCP tool in `tools/list`.

Every tool previously advertised a bare `inputSchema: { type: "object" }` — no
properties, no types, no required list, no bounds. Agents had to infer parameter
names from the prose description, which is how `max_results` came to be
passed-and-ignored (see `2026-07-25-inert-mcp-inputs-design.md`).

Each tool now publishes JSON Schema generated from **the same Zod object its
handler parses with** — the identical value, not a copy — so the advertised
contract and the enforced one cannot drift. `.strict()` surfaces as
`additionalProperties: false`, `.optional()` stays out of `required`, and string
and number constraints (`minLength`, `exclusiveMinimum`, …) come through.

Completeness is enforced at compile time: `TOOL_INPUT_SCHEMAS` is typed
`Record<McpToolName, z.ZodTypeAny>`, so adding a tool without a schema fails
`tsc` rather than silently shipping another bare listing.

**Nothing unenforced is advertised.** `max_results` publishes as an integer with
no `default` and no `maximum`, because the roadmap's `default: 50` /
`maximum: 500` are not enforced by the schema. The one `.default()` in the whole
tool surface (`approve_memory.approval`) is published because zod genuinely
applies it during `safeParse` — verified in a test, not assumed.

For 34 of 35 tools no handler behaviour changes and no input is newly rejected:
`.strict()` was already rejecting unknown keys, so `additionalProperties: false`
makes an existing rule visible rather than adding one.

**One behaviour change.** `get_task_context` was the lone input schema without
`.strict()` — it silently *stripped* unknown keys. Since `zod-to-json-schema`
emits `additionalProperties: false` for a stripping object too, publishing it
unchanged would have advertised a contract stricter than the handler enforced.
It is now `.strict()` like the other 34, so an unknown key is rejected instead
of dropped. Callers sending extra keys to `get_task_context` got no benefit from
them before; they now get a clear `validation_failed` instead of silence.

Uses `zod-to-json-schema`, already present in the lockfile as a dependency of
`@modelcontextprotocol/sdk` at our exact zod version — declaring it direct
downloaded and added zero packages.

See `docs/superpowers/specs/2026-07-25-publish-tool-input-schemas-design.md`.
