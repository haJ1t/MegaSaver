---
"@megasaver/llm-proxy": minor
"@megasaver/cli": minor
---

Add an opt-in local Anthropic-API proxy (Phase 0): `@megasaver/llm-proxy` +
`mega proxy start`. It binds 127.0.0.1, forwards `/v1/messages` (and all paths)
to the upstream **unchanged** (transparent passthrough, streaming preserved),
and records each round-trip's real token usage from Anthropic's `usage` —
counts + model only, never prompts, responses, or auth keys. This is the
measurement foundation for conversation-token saving (compression is a later
phase). Relaxes mission §1 "not a model proxy" to permit this opt-in proxy.
