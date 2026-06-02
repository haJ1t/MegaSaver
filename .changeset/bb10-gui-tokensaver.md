---
"@megasaver/gui": minor
---

Add the GUI Mega Saver Mode surface (AA1 BB10): TokenSaverPanel
(enable/disable + mode picker), token-saver modal + stats, and a
savings badge in the sessions list. New bridge routes under
`/api/sessions/:id/token-saver/{enable,disable,status,stats,events,events/:eventId/raw,events/:eventId/sent}`.
The panel renders only on open sessions; ended sessions show no
mutation surface. Events/raw/sent return empty/null honestly when no
content-store entries exist (no fabricated stats).
