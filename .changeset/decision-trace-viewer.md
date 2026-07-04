---
"@megasaver/cli": minor
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/gui": minor
---

Decision-Trace Viewer: surface the causal chain behind each context decision.

Registry/proxy outputs now record their ranking decision inline on the replay
trace — the classification, the selected/omitted chunks with their EngineScore
breakdown, the memory ids that boosted the ranking (`rankedByMemoryIds`), and the
redaction summary. Replay tracing is now **on by default** (disable with
`MEGASAVER_SEAM_TRACE=false`), bounded by a retention cap on trace-session dirs.

- New `readSessionDecisionTrace` reader joins the trace's inline attribution into
  a per-output `SessionDecisionTrace` (output granularity).
- New CLI: `mega trace explain <sessionId> --project <name> [--workspace <key>]
  [--json]` renders the causal chain for a registry session.
- New GUI: a Cytoscape decision-flow panel with a project-scoped session picker
  (traces come from proxy/registry sessions for the workspace).

Note: the memory attribution is *ranking-causal* (which memory boosted the
output's ranking), distinct from the evidence ledger's retention `pinnedByMemoryIds`.
`highRiskFindings` is the seam's redaction count. Traces exist only for
registry/proxy sessions; pure cockpit/overlay sessions show an honest empty state.
