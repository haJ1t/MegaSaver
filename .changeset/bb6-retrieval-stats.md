---
"@megasaver/retrieval": minor
"@megasaver/stats": minor
---

Add the `@megasaver/retrieval` and `@megasaver/stats` packages.

`@megasaver/retrieval` provides standalone, pure BM25 ranking over chunked
output text plus `DerivedIntent` derivation, giving the context gate a
deterministic relevance signal without spawning git or holding a persistent
index. `@megasaver/stats` adds the `SessionTokenSaverStats` and
`TokenSaverEvent` Zod schemas with append/update helpers that persist under an
injected store root (`<store>/stats/<projectId>/<sessionId>.json` +
`.events.jsonl`) using the atomic-write pattern from `@megasaver/core`, so
token-saver telemetry survives crashes without corrupting partial writes. Both
expose their public surface from `index.ts` with closed, alphabetically pinned
error-code enums.
