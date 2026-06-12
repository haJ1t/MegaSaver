---
"@megasaver/stats": minor
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 8 — Context Audit & Token-Savings Dashboard. Extends
@megasaver/stats (no new core entity) with an additive AuditEvent
discriminated union (context_pack_built, rule_applied, failure_avoided,
memory_retrieved, tool_route — scalar-only, no core types so the cycle
guard holds), written to a sibling <store>/stats/<projectId>/<sessionId>
.audit.jsonl (the byte .events.jsonl is untouched — no duplicate
token-saver accounting). New pure summarizeAudit(events, { window, now })
folds events in one exhaustive switch with window filtering
(session|week|all) and derives tokensSaved/percentageSaved using the
same formula as PackAudit; it imports no token estimator — tokensBefore/
After arrive already-estimated from Phase 3's auditPack (estimateSpanTokens)
carried verbatim into a context_pack_built event. New appendAuditEvent /
readAuditEvents JSONL writer+reader (reuses StatsError schema_invalid /
store_corrupt — no new codes). Core re-exports the audit surface (CLI/MCP
never import @megasaver/stats directly). One read-only MCP tool
audit_token_usage (bridge now 24 tools) and a mega audit CLI group
(report / last / session / export --format json) returning the dashboard
cards and the headline "would've been N tokens, was M, P% saved". Ships
the context_pack_built emission on the build path to prove the demo;
rule_applied/failure_avoided/memory_retrieved/tool_route emissions are
fast-follows (the summarizer already handles all five kinds). No LLM, no
new estimator, no GUI changes.
