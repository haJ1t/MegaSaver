---
"@megasaver/context-gate": patch
---

An unchanged re-read now reaches the ledger (spec §7 item 3, S2-2/S4-5).
Both read pipelines used to return the unchanged-marker before any event
append, so the suppression's saving AND its real envelope cost were invisible,
while the struct self-reported fabricated `returnedBytes: 0 / savingRatio: 1`.
The unchanged branch appends a compression-kind event with
`returnedBytes = mcpEnvelopeBytes(result)`, clamped `bytesSaved`/`savingRatio`
against the raw, a signed `deltaBytes`, and the prior chunk-set id — the same
envelope-true accounting as a normal read. The delivered marker struct itself
is unchanged.
