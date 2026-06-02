---
"@megasaver/core": minor
"@megasaver/cli": minor
---

Add `mega output exec` — the first user-visible child-process spawn in
Mega Saver. A new core orchestrator `runOutputExecCommand`
(`packages/core/src/context-gate/run-command.ts`, re-exported from the
`context-gate.ts` barrel) spawns a policy-gated child process and runs
its combined stdout+stderr through the redact -> filter -> store ->
stats pipeline; the `mega output exec` CLI command is a thin adapter
that calls it, and BB8's MCP `mega_run_command` will reuse the same
entry point.

Security invariants enforced and tested: `policy.evaluateCommand` runs
BEFORE spawn (deny-before-spawn, with a spawn-never-called assertion on
every denial branch — `command_not_allowed`, `dangerous_pattern`,
`recursive_megasaver`); `MEGASAVER_ORIGIN_PID` is set on the spawned
child env and checked on entry so a descendant re-entering Mega Saver is
denied `recursive_megasaver`; redaction runs before persistence (the
raw unredacted output is never stored). The child's exit code is
mirrored on a clean run; `--timeout`/`--max-bytes` bounds (defaults 300s
/ 20MB) force-terminate but still persist the partial output as exit 1.

`@megasaver/core` now depends on `@megasaver/stats` for the stats step;
this is acyclic (stats never imports core) and the dependency-direction
allow-list is widened accordingly. `@megasaver/cli` gains no direct
stats dependency — it consumes the orchestrator through
`@megasaver/core` only.
