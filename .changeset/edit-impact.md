---
"@megasaver/mcp-bridge": minor
"@megasaver/connectors-shared": minor
---

Edit impact: surface the blast radius of an edit — impacted callers and the
tests to run — directly to connected agents, without manual dependency lookup.

- `@megasaver/mcp-bridge`: new `get_edit_impact` MCP tool. Seeds from
  `changedFiles` (or `git diff --name-only HEAD`, degrading gracefully to an
  empty set on non-git roots), merges per-seed impact packs deduped by block
  id, and returns the impacted callers plus `suggestedTests` — the test-typed
  blocks inside the merged radius.
- `@megasaver/connectors-shared`: the context-gate block now instructs the
  agent to call `get_edit_impact({ projectId })` after editing files so
  impacted callers and suggested tests surface automatically.
