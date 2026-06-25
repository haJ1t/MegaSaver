---
"@megasaver/daemon": minor
---

Add `getRunningDaemon` — a no-spawn client that returns a `DaemonHandle` if a daemon is already
running at the discovery path, or `null` otherwise. Never spawns, never waits, never mutates
lock/discovery. Used by the `mega hooks saver` PostToolUse hook to forward captured tool output
to the daemon's `/excerpt` route with a 1.5s timeout, falling back to in-process
`recordAndFilterOverlayOutput` on any failure (daemon absent, connection error, or non-2xx).
