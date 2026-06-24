---
"@megasaver/gui": patch
---

Token-saver panel now shows when each save happened: a "when" column on the
per-save table (local date + time to the second, `YYYY-MM-DD HH:MM:SS`) and a
"Last save" row in the session summary. Render-only — uses the `createdAt` /
`updatedAt` timestamps already present on the saver event/stats records.
