---
"@megasaver/core": minor
"@megasaver/cli": minor
"@megasaver/mcp-bridge": minor
---

M4 transcript→memory: deterministically distill a recorded session's failures
into `suggested` memories for the human approval gate (claude-mem-class session
distillation, the no-LLM variant).

- `@megasaver/core`: new pure `extractSessionMemories(input)` derives candidate
  memories from a session's structured `FailedAttempt` rows — a test-shaped
  failure → a `test_behavior` candidate, a generic one → a `bug` candidate
  (source `test_failure`), a `DECISION:` marker → a `decision` candidate
  (source `session_summary`). Identical candidates within a session collapse by
  content hash. No model, no I/O, no clock.
- `@megasaver/cli`: `mega memory from-session <session>` stages the candidates
  as `suggested` (never auto-approves) and prints `suggested=N skipped=M`
  (`--json` available). Idempotent — a per-candidate dedupe key carried in the
  memory's keywords means a re-run stages no duplicates.
- `@megasaver/mcp-bridge`: `mega_memory_from_session` MCP tool with the same
  behaviour (`{ sessionId } -> { suggested, skipped }`).

Suggested memories are not recallable until a human approves them (M3 then
surfaces semantic duplicates at the approve gate), so a noisy extractor never
leaks into recall. Additive; no change to the memory data model, the approval
gate, or existing FORGE/learn behaviour.
