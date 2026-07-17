---
"@megasaver/core": patch
---

Internal refactor: hoist the triplicated advisory atomic-JSON-store mechanic
into one core-internal `json-store.ts` (`readJsonFile` + `writeJsonAtomic`),
reused by `guard-state`, `warm-start-state`, and `autopilot-store`. Behavior is
byte-identical — the helper owns only the filesystem plumbing; each store keeps
its own Zod schema and fallback, so every error posture is preserved (guard/warm
return `null`, autopilot fails closed to a `structuredClone`d default). No public
API change. The three durable, fsync-ing, throwing atomic writers (embeddings,
overlay, registry) are deliberately untouched — different contract.
