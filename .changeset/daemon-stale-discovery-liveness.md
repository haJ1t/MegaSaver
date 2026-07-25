---
"@megasaver/daemon": patch
---

Check that the daemon process recorded in the discovery file is still alive
before trusting the port it advertises.

`getRunningDaemon` / `getDaemon` read `<store>/daemon/daemon.json` and pinged
`GET /status` on the recorded port, treating any `res.ok` as "our daemon".
`discoverySchema` has carried `pid` since the start but nothing ever read it.
`clearDiscovery` only runs in `server.close()` and the CLI's SIGINT/SIGTERM
handler, so SIGKILL/crash/power-loss leaves the record behind — with a port that
is random and ephemeral (`server.listen(opts.port ?? 0)`), hence quickly
reusable.

Whatever local process next bound that port and answered 200 on `/status`
received the daemon's bearer token and had its JSON returned verbatim as MCP
tool output: `forwardOrFallback` (`mcp-bridge/src/tools/forward.ts:21`) does
`mapResponse(await res.json())` with the default identity mapper for
`proxy_read_file`, `proxy_run_command` and `proxy_search_code`, and the
PostToolUse saver hook (`apps/cli/src/hooks/saver-run.ts:112`) casts the same
body straight to `RecordOverlayOutputResult`. Attacker-chosen file contents and
command output landed in the agent's context as trusted tool results.

Before: with the daemon SIGKILLed and a squatter listening on the freed port,
`getRunningDaemon` returned a handle to the squatter and sent it
`Bearer <stale token>`. After: it returns `null` and the caller falls back
in-process; `getDaemon` reaps the stale record and spawns a real daemon. The
squatter receives zero requests.

Liveness is `process.kill(pid, 0)` inside `ping`, so both entry points and the
post-spawn wait loop are covered by construction. `EPERM` counts as alive (the
pid exists, it just isn't ours to signal) so a permission quirk cannot wedge a
running daemon into a respawn loop. Pid reuse is still theoretically possible;
closing that needs a unix domain socket, not a wider check here.

Covered by `test/client.test.ts`, which drives real sockets: a real child
process is spawned and awaited to exit to obtain a definitively dead pid, and a
real HTTP impostor binds a real port and records the `authorization` headers it
is sent.
