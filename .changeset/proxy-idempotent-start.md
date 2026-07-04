---
"@megasaver/cli": minor
---

Idempotent proxy start: a redundant `mega proxy supervise` bind no longer
crashes on `EADDRINUSE`. Fixes the launchd crash-loop where a respawn (or a
second `mega proxy start`) hit `listen EADDRINUSE 127.0.0.1:8787`, rejected the
bind promise uncaught, and let the KeepAlive LaunchAgent respawn on repeat.

`mega proxy supervise` binds through `bindWithRetry`. On `EADDRINUSE` it retries
the bind a bounded number of times (~300 ms apart) to absorb the launchd respawn
release-race; if a retry succeeds it starts normally. When `EADDRINUSE` persists
across every attempt, another instance/process owns the port on a KeepAlive
singleton, so the supervisor prints one clear stderr line and exits 0 —
`KeepAlive{SuccessfulExit:false}` does not respawn a clean exit, which stops the
crash-loop. A non-`EADDRINUSE` bind error still surfaces (non-zero exit); no raw
stack trace, no unhandled rejection. The port holder is never killed — launchd
owns lifecycle and the plist is unchanged.
