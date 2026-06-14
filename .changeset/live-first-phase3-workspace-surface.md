---
"@megasaver/shared": minor
"@megasaver/indexer": minor
"@megasaver/core": minor
---

Add the live-first Phase 3 workspace-keyed read surface.

- `@megasaver/shared`: `workspaceKeySchema`, `encodeWorkspaceKey(cwd)`
  (`sha256(cwd)` → 16 lowercase-hex chars), and `workspaceLabel(cwd)` —
  an fs-safe key space distinct from the lowercase-UUID `projectId`.
- `@megasaver/indexer`: `resolveWorkspaceIndexPaths(storeDir, key)` and
  `buildWorkspaceIndex(...)` write under `index/<workspaceKey>/`, plus
  `workspaceProjectId(key)` (a deterministic UUIDv5 stamped on index
  blocks so `codeBlockSchema` parses without a schema migration).
- `@megasaver/core`: `readWorkspaceRules` / `readWorkspaceTools` read the
  workspace-keyed overlay JSONL (`rules/<key>.jsonl`, `tools/<key>.jsonl`),
  reusing the existing rule/tool zod schemas. Read-only; no registry.
