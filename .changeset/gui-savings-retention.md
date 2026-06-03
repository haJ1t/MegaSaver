---
"@megasaver/gui": minor
---

Add a token-savings trend chart and raw-output retention controls to the
Mega Saver Mode panel.

- **Savings chart (3c):** a hand-rolled inline-SVG bar chart (no charting
  dependency) of per-event `savingRatio`, embedded in the token-saver stats
  block. Accessible as `role="img"` with an `aria-label` summarising the trend
  ("Savings trend: N events, avg X%"); empty state when there are no events.
- **Retention controls (3d):** new bridge routes
  `GET /api/sessions/:id/retention` (chunk-set count, total bytes, oldest
  timestamp), `POST .../retention/clear`, and `POST .../retention/prune`
  ({days}) — all strictly scoped to the session's own stored output via
  `@megasaver/content-store`. The GUI shows the stored-output summary and a
  destructive "Clear stored raw output" action behind an explicit two-click
  in-UI confirm, with the result announced through a polite live region.
