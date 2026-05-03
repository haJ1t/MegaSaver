# Language & i18n

## Source language

- Code, identifiers, comments, docs, commit messages: English.
- Spec / plan files: English.
- Agent files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`): English.
- Conversation language may vary; the OUTPUT (code, docs, commits)
  is always English.

## Product user-facing strings (deferred)

- v0.1 CLI: English only. Hardcoded strings.
- v0.2+: i18n via `packages/shared/i18n`. Default `en`, then add
  `tr` second.
- Never hardcode Turkish in code. Route through the i18n layer
  (when it exists).
