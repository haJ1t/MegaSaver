---
"@megasaver/core": minor
"@megasaver/cli": minor
---

feat: add session CRUD CLI commands and core endSession method

`@megasaver/core` gains `CoreRegistry.endSession(id, { endedAt })`
on both registry implementations and a new `session_already_ended`
error code. `@megasaver/cli` gains four `mega session` subcommands
(`create`, `list`, `show`, `end`) plus the supporting CLI error
helpers.
