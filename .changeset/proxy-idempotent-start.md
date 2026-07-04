---
"@megasaver/llm-proxy": minor
"@megasaver/cli": minor
---

Idempotent proxy start: a redundant `mega proxy supervise` bind no longer
crashes on `EADDRINUSE`. Fixes the launchd crash-loop where a respawn (or a
second `mega proxy start`) hit `listen EADDRINUSE 127.0.0.1:8787`, rejected the
bind promise uncaught, and let the KeepAlive LaunchAgent respawn on repeat.

- `@megasaver/llm-proxy`: `verifyHealth` — a pure, injectable health probe that
  confirms a port holder is our live proxy via the cryptographic
  challenge-response (`proof === HMAC-SHA256(healthCapability,
  instanceId||challenge)`, constant-time), answered locally and never forwarded
  upstream. A wrong proof is rejected, so a foreign process on the port is never
  mistaken for ours.
- `@megasaver/cli`: `mega proxy supervise` binds through `bindOrDetectRunning`,
  which on `EADDRINUSE` decides ownership before acting — confirmed-ours (health
  proof, or pid-liveness fallback via `isLiveSameBoot`) logs `proxy already
  running` and exits 0; a release-race retries the bind a bounded number of
  times; a foreign holder prints a clear one-line stderr message and exits
  non-zero. No raw stack trace, no unhandled rejection. The port holder is never
  killed — launchd owns lifecycle and the plist is unchanged.
