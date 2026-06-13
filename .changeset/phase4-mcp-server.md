---
"@megasaver/shared": minor
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
---

Phase 4 — MCP Server full surface. Adds two first-class core entities
(ProjectRule, FailedAttempt) with schemas, branded ids, JSONL storage, and
registry CRUD, plus four MCP tools: `get_project_context`,
`record_failed_attempt`, `save_project_rule`, `get_project_rules`. The bridge
now exposes 15 tools. Additive only — no existing schema, store, or tool
changes shape.
