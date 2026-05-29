---
"@megasaver/cli": minor
---

Add the `mega session saver {enable,disable,status,stats}` command surface
(AA1 epic, BB2). `enable` toggles Mega Saver Mode on a session with a
required `--mode safe|balanced|aggressive`, persisting `tokenSaver`
settings via `CoreRegistry.updateTokenSaver`; `disable` clears the
enabled flag; `status` and `stats` report current state. `--mode` is
rejected on the non-enable subcommands. `stats` reports settings only and
signals that per-call event stats arrive with BB6 (no faked data source).
A new `invalidModeMessage` / `unexpectedModeMessage` pair is exported from
`apps/cli/src/errors.ts`.
