---
"@megasaver/connectors-shared": minor
"@megasaver/cli": patch
---

Connector drift detection now classifies in-sync/noop by EOL-normalized
comparison, so a file whose halves merely disagree on line ending (CRLF
vs LF, common on Windows) is no longer misreported as drift. The
EOL-preserving bytes written on a real change are unchanged. New
`normalizeEol` export on `@megasaver/connectors-shared`.
