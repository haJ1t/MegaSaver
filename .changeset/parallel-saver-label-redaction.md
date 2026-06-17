---
"@megasaver/context-gate": patch
---

Redact the source label/command/args/path before persistence on the remaining
saver paths. PR #148 fixed only `recordAndFilterOverlayOutput`; the parallel
live paths still wrote the raw label to disk:

- `run-command.ts` (`runOutputExecCommand` legacy + `runOverlayOutputExecCommand`
  overlay — the latter wired into `proxy_run_command`) persisted
  `source.command` + `source.args` and the stats event `label` raw. Because it
  stores the real `args` array, a bearer token in `curl -H "Authorization:
  Bearer ..."` landed verbatim in `source.args` on disk.
- `run.ts` (legacy + overlay file pipelines) persisted the file `path` raw in the
  stats event `label`.
- `read.ts` `persistChunkSet` + `persistOverlayChunkSet` persisted the file
  `path` raw in `source.path`.

Each sink now applies `@megasaver/policy` `redact` (the same detector used for
chunk content): the command and each `args` element are redacted element-wise,
the joined event label is rebuilt from the redacted parts, and the file path is
redacted at the `persist*` sink (covering every caller of those exported
functions) and again for the event label in `run.ts`. Redaction stays readable
(secret → marker, not blanked).

Known limit (unchanged from #148): `redact` only catches prefix/structure-shaped
secrets, so a bare `?token=<hex>` query param or `user:pass@host` basic-auth in a
command/path is still not caught — the same blind spot the content redactor has.
Hardening `packages/policy/src/redaction-patterns.ts` is tracked separately.
