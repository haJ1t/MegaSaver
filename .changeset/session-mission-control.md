---
"@megasaver/daemon": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

Session mission control (wave-4 2/3): live presence table + burn + claim warnings. Pure `buildLiveTable`/`deriveStatus`/`shortCwd` in daemon, `mega sessions live` CLI (read-only advisory, fail-open, cwdShort redacted), GUI `GET /api/sessions/live` + `SessionsLivePanel` (poll 5s, status colors, burn sparkline placeholder). TDD 6+4+5 tests, pnpm verify green.
