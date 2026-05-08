---
"@megasaver/core": patch
---

Two cohesive correctness fixes:

- M3: stale-lock detection. `withDirLock` writes the holding PID
  into `.projects.lock` and uses `process.kill(pid, 0)` to detect
  dead holders. Crashed-process recovery now happens immediately
  rather than waiting the full 5s acquire timeout.
- M4: Unicode NFC normalization. `Project.name` and `Session.title`
  Zod schemas now normalize to NFC at parse time. NFD inputs are
  observably equal to their NFC equivalents post-parse. Migration
  is lazy: existing on-disk NFD entries are returned as NFC on
  read; subsequent writes persist NFC.

Public API output type is unchanged (`string` stays `string`),
but a literal NFD input no longer round-trips byte-equal — it
becomes its NFC equivalent. Callers comparing literal byte-strings
against parser output should normalize their fixtures to NFC.
