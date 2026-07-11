---
"@megasaver/stats": minor
"@megasaver/context-gate": minor
"@megasaver/llm-proxy": minor
"@megasaver/proxy-control": minor
"@megasaver/cli": minor
"@megasaver/daemon": patch
"@megasaver/core": patch
---

Saver metrics honesty wave 5 (F30-F34): every reported number now counts
the bytes actually delivered to the model, and no ratio divides mismatched
scopes. `recordAndFilterOverlayOutput` computes the persisted
returnedBytes/bytesSaved/savingRatio from the FINAL delivered text — D16
elision markers plus the recovery footer, which now renders inside record
(new canonical `buildRecoveryFooter` + `includeFooter` flag, wired through
the saver hook and the daemon /excerpt schema) — and degrades to
passthrough with ZERO side effects when a compressed replacement would be
net-negative. Overlay events carry `secretsRedacted`/`chunksStored`, so
summary rebuilds recover both counters without carryForward, and the GC
reconcile counts schema-valid lines only (garbage lines no longer force a
rebuild every sweep). The proxy usage reader tolerates torn JSONL lines
and `mega audit usage` reports the skipped count, matches a GLOBAL savings
numerator to the global usage denominator, adds a per-workspace savings
breakdown (no unattributable ratios), and carries a scoped-ratio branch
for future workspace-keyed usage rows. The proxy supervisor re-applies a
removed route in place (lease kept; counter surfaced by the new
`saver-proxy-route` doctor check), and metering is no longer framed as
saving: `saver_mediated_token_savings`, `mediation: "saver_hook"`, and an
explicit metering note in the audit report.
