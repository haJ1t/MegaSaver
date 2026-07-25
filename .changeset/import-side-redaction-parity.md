---
"@megasaver/core": patch
---

Redact every secret-bearing memory field on the **import** side, not just
`content` and `title`.

`applyHandoffMemories` (`mega handoff open <packet> --merge`) ran
`redactWithFindings` over `content` and `title` only, then spread the rest of
the packet entry straight into `registry.createMemoryEntry`, which does nothing
but `memoryEntrySchema.parse`. `mega brain import` redacted nothing at all. Both
inputs are untrusted: `parseHandoffPacket` verifies no signature, only a
self-computed `payloadSha256` an attacker recomputes freely.

Measured on a packet whose `content`/`title` are benign, through the real
registry:

| field | before | after |
|---|---|---|
| `title`, `content` | scrubbed | scrubbed |
| `reason`, `goal` | **raw** | scrubbed |
| `evidence[]`, `keywords[]` | **raw** | scrubbed |
| `relatedFiles[]`, `relatedSymbols[]` | **raw** | scrubbed |
| `anchor.files[].path` | **raw** | anchor dropped |
| `report.redactionFindings` | 2 (of 7) | 7 |

The fix routes both importers through the same `redactMemory` /
`makeRedactor` the pack side already uses (`handoff-export.ts`,
`brain-export.ts`), so an importer can no longer scrub fewer fields than the
exporter — including the anchor, which drops whole rather than being rewritten,
because its path is the `cat-file HEAD:<path>` lookup key. `redactionFindings`
now sums the redactor's total, so the open-side warning stops under-reporting
what it let through. Dedupe and `mega brain import`'s content key both move to
the redacted content, keeping a re-run of a secret-bearing packet idempotent.

Not covered: `mega brain import` still writes rules and failures unredacted,
and the `handoff:<sourceProject.name>` provenance string is still appended raw.
Both are the same class on other fields.
