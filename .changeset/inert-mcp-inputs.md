---
"@megasaver/mcp-bridge": major
---

Honor `max_results` in `proxy_search_code`, and stop accepting `around` in
`proxy_expand_chunk`.

Both were declared in `.strict()` Zod schemas and never read by any code. Because
the schemas are strict, they were among the very few keys a caller could pass
*without* an error — every other unknown key failed loud, these two were accepted
and dropped. An agent asking for `max_results: 10` silently received every match.

**`max_results` now caps the file list.** The cap runs *after* BM25 re-ranking,
so it keeps the highest-ranked files rather than whichever ones `grep` emitted
first. When it drops anything, the result carries a new optional field:

```ts
omitted?: { files: number; matches: number }
```

A cap that hides its own effect would be worse than the ignored parameter it
replaces — the agent would act on a truncated list believing it complete. Nothing
is lost either way: the full raw output stays retrievable through the
`chunkSetId` already on the result.

`max_results` stays optional with **no default**. The `default: 50` in
`docs/superpowers/plans/2026-06-12-proxy-mode-v1.2-roadmap.md:890` was never
implemented, and adopting it now would silently truncate every existing caller
that never asked for a cap. Absent ⇒ uncapped, exactly as before.

**`around` is removed from the `proxy_expand_chunk` schema.** Neighbouring-chunk
fetch was declared and never built, so a caller asking for context silently got a
single chunk. That is an unbuilt feature rather than an ignored knob, so it is
rejected rather than implemented on the side; `.strict()` now returns
`validation_failed` with zod naming the key. It returns together with a real
implementation.

Major, not minor: removing an accepted input from a published tool schema on a
post-1.0 package is a breaking change, even though the input never did anything.
The practical blast radius is a caller that was relying on `around` being
silently tolerated, and no such caller exists in this repo — but "it was already
broken" is not a semver exemption. `max_results` and the new `omitted` field are
additive on their own: callers that sent neither see byte-identical results.

See `docs/superpowers/specs/2026-07-25-inert-mcp-inputs-design.md`.
