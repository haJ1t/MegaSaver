---
"@megasaver/cli": major
"@megasaver/core": minor
"@megasaver/entitlement": patch
---

`mega brain export <project>` / `mega brain import <project> <file>` — the
portable project brain (Mega Saver Pro). Export writes the knowledge layer
(approved project-scoped memories, rules, failed-attempt lessons) to a
2-line `.megabrain` bundle with a SHA-256 payload integrity hash and
firewall redaction (findings counted in the manifest). Import verifies the
hash, then merges everything as NEW entries with `approval: "suggested"` —
nothing activates until `mega memory approve`; exact duplicates are skipped
and counted. Core gains `exportBrain` / `importBrain` /
`parseBrainBundle` / `serializeBrainBundle`.
