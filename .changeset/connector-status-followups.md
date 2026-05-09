---
"@megasaver/cli": patch
---

Fix `mega connector status`: swap `pickLatestOpenSession` to a
`Date.parse` numeric comparator (correct ranking under mixed
RFC 3339 offsets) and emit the `session=<id|none>` suffix on the
`error` status line for column symmetry across all five status
words. Sync output is unchanged.
