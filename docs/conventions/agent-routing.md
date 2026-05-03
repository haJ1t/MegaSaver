# Agent Routing

Choose the lightest path that preserves quality.

## Direct work (no delegation)

- Trivial ops (single file rename, one-liner fix, copy edit).
- Direct config writes: `~/.claude/**`, `.omc/**`, `.claude/**`,
  `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`.
- Single bash commands.
- Quick clarifications.

## Delegate to specialized agent

| Situation                                          | Agent                  |
|----------------------------------------------------|------------------------|
| Multi-file changes / refactors                     | `executor` (opus)      |
| Codebase exploration > 3 queries                   | `explore`              |
| Architecture / trade-off / design decisions        | `architect` (opus)     |
| Step-by-step implementation plans                  | `planner` (opus)       |
| Debugging non-trivial bugs / regression isolation  | `debugger`             |
| Pre-merge code review                              | `code-reviewer`        |
| Adversarial second-opinion review                  | `critic` (opus)        |
| Verification / DoD evidence                        | `verifier`             |
| External SDK / API docs lookup                     | `document-specialist`  |
| Security / OWASP / secrets sweep                   | `security-reviewer`    |
| Test strategy / hardening flaky tests              | `test-engineer`        |
| Tracing causal hypotheses                          | `tracer`               |
| Docs / README / API docs                           | `writer` (haiku)       |
| UI/UX implementation work                          | `designer`             |

## Model routing

- `haiku`  — quick lookups, simple writes.
- `sonnet` — standard implementation.
- `opus`   — architecture, deep analysis, security, complex review.

## Parallel rules

- 2+ independent tasks → dispatch in single message
  (multiple Agent tool uses in one assistant turn).
- Builds / tests / long ops → `run_in_background`.
- Sequential when result of one feeds another.
