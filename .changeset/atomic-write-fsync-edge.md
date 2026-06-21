---
"@megasaver/content-store": patch
"@megasaver/agent-office": patch
---

atomicWriteFile no longer reports a failure when the post-rename
parent-directory fsync throws. Once the rename commits, the file is
written; the directory fsync is a durability hint, not a correctness
gate. Prevents spurious write_failed errors that could trigger
double-writes in caller retry logic.
