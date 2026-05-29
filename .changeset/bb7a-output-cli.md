---
"@megasaver/cli": minor
---

Add the `mega output {file,filter,chunk}` CLI surface. `mega output file`
reads an on-disk file through the two-gate path-safety pipeline, runs it
through `filterOutput`, and optionally persists the resulting chunk-set.
`mega output filter` runs an existing log file through the same filter
pipeline (sandbox resolver only) so `pnpm test > log.txt && mega output
filter` works. `mega output chunk` returns a single stored chunk from a
previously persisted chunk-set, located by `<chunk-set-id>` alone. No
child-process execution is introduced (enforced by a `no-child-process`
guard test); the commands wire `@megasaver/policy`,
`@megasaver/output-filter`, and `@megasaver/content-store` into the CLI
behind the existing path-safety and redaction gates.
