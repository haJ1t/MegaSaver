---
"@megasaver/shared": minor
---

Project/session/memory id schemas now require lowercase UUIDs (reject
uppercase/mixed-case). Makes the case-collision safety explicit at the
boundary. Error-surface change: an uppercase id on a CLI command (`mega
session show <ID>`) or GUI bridge path param now fails validation
("id must be lowercase") instead of resolving to a 404. randomUUID
already mints lowercase, so no production write path regresses.
