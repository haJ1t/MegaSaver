---
"@megasaver/context-gate": patch
"@megasaver/daemon": patch
"@megasaver/cli": patch
---

Byte-identical stdout+stderr parts no longer collapse into one overlay
savings event. `RecordOverlayOutputInput` gains an optional
`streamSlot: "stdout" | "stderr"` that joins the overlay event id hash when
present; the saver hook names it per dual-stream part and the daemon
`/excerpt` body schema carries it so the daemon and the in-process fallback
derive the same id for the same part. An absent slot hashes to the exact
pre-slot id, so existing callers, recorded history, and old daemons stay
id-compatible (an old strict-schema daemon rejects the field with a 400,
which the hook client already treats as a fallback).
