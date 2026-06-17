---
"@megasaver/connectors-shared": minor
"@megasaver/cli": patch
---

Plan 3c — per-target projection conformance. Add a fail-closed `projectionPreflight`
(spec §11 matrix + §14 "projection preflight failure aborts the connector write")
that validates the final rendered connector output before the atomic write: exactly
one balanced Mega Saver managed block, a balanced `CONTEXT_GATE` block when present,
and surviving header/frontmatter for header targets (Cursor). It reuses `parseBlock`,
rewraps a `block_conflict` as a new `projection_invalid` error code, and is
agent-agnostic (takes the rendered string + `{ expectHeader }`, not a `ConnectorTarget`).

`mega connector sync` now runs the preflight before each write (seed + update paths);
an unconformant projection aborts only that connector's write — the store and other
targets are untouched. A unified conformance matrix test across all 7 known targets
(Claude Code, Codex, Cursor, Aider, Gemini, Windsurf, Continue) pins §11 as a
regression guard. Preflight is defense-in-depth: `upsertBlock` is already correct, so
this guards against a future renderer/merge regression silently corrupting a user's
agent-config file.
