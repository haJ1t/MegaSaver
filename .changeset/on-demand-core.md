---
"@megasaver/policy": minor
"@megasaver/cli": minor
---

On-demand core (wave-4 3/3): daemonless one-shot worker from standalone bundle for read-only commands. Closed allowlist gate in policy, `mega.config.json {core:"on-demand"}` + flag precedence, single-shot spawn with bounded framing and SIGTERM→KILL, same core/content-store read path, gate before spawn. TDD 5+3+3+4 tests, pnpm verify green.
