---
"@megasaver/core": minor
"@megasaver/mcp-bridge": patch
"@megasaver/cli": patch
---

Reserve the `from-session:` idempotence-ledger keyword namespace so an agent can
no longer suppress a legitimate autopilot / from-session capture by planting a
forged ledger keyword (i14 gauntlet finding #5, denial-of-capture).

- core: new `isReservedKeyword` / `stripReservedKeywords` exports; `brain import`
  strips reserved keywords from imported memories.
- mcp-bridge: `save_memory` strips reserved keywords from agent input.
- cli: `memory create` strips reserved keywords; `memory update` strips a forged
  add AND preserves the row's existing reserved keyword (so an edit can't drop
  the real ledger entry). Internal ledger writers (from-session, autopilot) build
  the keyword themselves and are unaffected; the shared ledger still dedupes.
