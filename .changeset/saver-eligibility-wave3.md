---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/daemon": patch
"@megasaver/cli": minor
---

Saver eligibility + ranking wave 3: the hook's byte gate is now the single
compression-eligibility authority (no more 4–8 KB dead band), safe mode
compresses Bash below Claude Code's output ceiling, file reads get semantic
AST chunking, compressed views render in source order with `… [lines A-B
omitted]` markers, intent is per-session with a 30-minute TTL, the intent
tokenizer understands non-ASCII prompts, and a committed
`.megasaver/policy.json` can floor the mode a repo may be compressed with.
