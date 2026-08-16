---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

Memory write-verify follow-up: the write gate now also covers `mega
memory from-session` (test_failure candidates) and brain autopilot —
autopilot auto-approve requires a verified `autopilot@` attestation
(cross-session recurrence) plus a clean conflict corpus (duplicate /
supersession / contradiction all block), closing the
machine-approves-conflict hole; gated rows carry a 90d default TTL and
a system validation sidecar. Agents cannot forge attestations
(fail-closed at the MCP resolver). `mega rules apply` and the GUI
workspace-rules route now exclude expired rules via `asOf`, matching
`get_applicable_rules`.
