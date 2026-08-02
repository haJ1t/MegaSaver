---
"@megasaver/cli": minor
"@megasaver/connector-claude-code": patch
---

Add an optional Claude Code PreToolUse batch-read adviser. After two eligible
Read, Grep, or Glob calls in the same directory within sixty seconds, the hook
offers one concise `additionalContext` suggestion for batching the remaining
exploration. The current call stays native and remains subject to Claude Code's
permission controls; the adviser never returns an allow or deny decision.

An advice event records only that guidance was offered. It is not a
token-saving event and makes no claim that the agent followed the advice or
that any tokens were saved.
