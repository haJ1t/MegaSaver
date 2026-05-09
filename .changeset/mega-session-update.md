---
"@megasaver/core": minor
"@megasaver/cli": minor
---

Add `mega session update <sessionId> [--title …] [--risk …] [--agent …]`
for partial mutation of an open session. Empty `--title ""` clears
to `null`; ended sessions are rejected (`session_already_ended`);
`mega session update <id>` with no flags emits `error: nothing to
update`. `@megasaver/core` exports `sessionUpdatePatchSchema` and a
new `CoreRegistry.updateSession(id, patch)` method on both the
in-memory and JSON-directory implementations. `apps/cli`'s
`commands/session.ts` is split into a `commands/session/`
directory closing v0.1 backlog item I5.
