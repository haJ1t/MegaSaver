---
"@megasaver/policy": patch
---

Apply the secret-path denylist to command arguments, not just to read paths.

`evaluateCommand` checked the command name and the rendered command line, never
the individual args. `ALLOWED_COMMANDS` holds five file-reading commands (`cat`,
`find`, `grep`, `ls`, `tail`), so every exec surface read exactly the paths the
read gate refuses — the denylist was one tool call wide.

Measured against the real orchestrator (`runOutputExecCommand` from
`@megasaver/context-gate`, real `spawn`, real `filterOutput`, real `.env` on
disk):

| call | before | after |
|------|--------|-------|
| `grep -r -n --include=.env -e = .` (the exact vector `buildGrepArgs` emits for `proxy_search_code({include_globs: [".env"]})`) | `ok: true`, excerpt `./.env:1:AWS_SECRET_ACCESS_KEY=… ./.env:2:DB_PASSWORD=… ./.env:3:STRIPE_LIVE=…`, 0 redactions | `command_denied` / `secret_path_read`, never spawned |
| `cat .env` (`mega_run_command`) | `ok: true`, full file body | `command_denied` / `secret_path_read`, never spawned |
| `grep -r -n --include=*.ts -e const .` | `ok: true` | `ok: true` (unchanged) |

`runOutputPipeline({path: ".env"})` denied the same file with
`secret_path_read` throughout, so this closed a bypass of an already-enforced
gate. Redaction was no backstop: `redactWithFindings` over that grep output
returns `count: 0` — the `./.env:1:` prefix defeats the `^`-anchored `env_value`
detector, and `aws_secret_key`'s lookbehind is lowercase-only.

Each arg is now evaluated by `evaluatePathRead`, along with the tail after a
`=` so a flag-attached glob (`--include=<glob>`) is seen. Project `deny.read`
globs apply to args too, so a tightened `permissions.yaml` covers exec as well
as read. Only the LOCKED §9a denylist can deny, so an arg must look like a
secret path to be rejected.

Fixed once in the shared sink: `mega output exec`, `mega bench`,
`proxy_search_code`, `mega_run_command`, the daemon `/exec` and
`/exec-registry` handlers, and the overlay exec twin all route through
`evaluateCommand`.

This is an input gate. Content that a recursive `grep -r . ` sweeps out of a
denied file it was never handed is an output-side concern and remains out of
scope (2026-07-08 context-firewall spec non-goal).
