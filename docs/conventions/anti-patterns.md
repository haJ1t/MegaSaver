# Anti-Patterns

Hard "don't" list. Not preferences. Violating any fails review.

- No half-implementations. If you can't finish in this PR, scope
  smaller — don't merge stub functions.
- No fallbacks for cases that cannot happen. Trust internals.
  Validate only at system boundaries.
- No backward-compat shims pre-1.0. Break things; bump version.
- No premature abstraction. 3 similar lines > 1 fragile abstraction.
- No comments without a WHY. No "what" comments. No "added for
  feature X" rot.
- No "wip" / "fix typo" / "address feedback" commits on `main`.
  Squash before merge.
- No `--no-verify`, `--no-gpg-sign`, hook bypasses unless user
  asked explicitly.
- No silent retries on error. Diagnose the root cause.
- No raw tool output / test log / build log into context. Mega
  Saver's whole purpose is to compress these. Use the Tool Output
  Compressor (when shipped) or its manual equivalent — root cause
  + first failure + exit code.
- No agent-specific logic in `@megasaver/core`. Connectors isolate.
- No memory writes without metadata. Every memory item must carry:
  source, timestamp, confidence, scope, expires (or null).
- No destructive ops (`rm -rf`, force push, branch delete, history
  rewrite) without explicit user confirmation in same conversation.
- No "this feature is too small for a spec." See
  `process-discipline.md` hard rule.
- No `author == reviewer`. The reviewer agent runs in a fresh
  context with no memory of authoring.
- No editing `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` without
  also editing `docs/conventions/` source of truth.
- No claiming "done" / "fixed" / "passing" before
  `definition-of-done.md` met.
