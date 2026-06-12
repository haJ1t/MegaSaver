---
"@megasaver/shared": minor
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 7 — Tool Router. Adds a deterministic, per-project tool router. New
first-class ToolDefinition entity (name/description, category enum
[filesystem/search/git/test/package/database/deploy/browser/dangerous],
risk enum [safe/medium/dangerous], normalized keywords, opaque
z.unknown() inputSchema/outputSchema — descriptive only, never executed),
stored as per-project JSONL. New pure routeToolsForTask(tools, query)
reusing rankBm25: a security gate runs BEFORE relevance — a tool is
blocked (never routed to a plain task) when risk=dangerous OR category in
{dangerous, deploy, database}; among the rest, score>0 tools are allowed
(descending score, id tiebreak), irrelevant tools are omitted. Returns
{ allowedTools, blockedTools, reason }. New branded ToolDefinitionId,
4 CoreRegistry methods (createToolDefinition, getToolDefinition,
listToolDefinitions, routeToolsForTask), 2 error codes
(tool_definition_already_exists, tool_definition_not_found), 1 MCP tool
route_tools_for_task (bridge now 23 tools), and CLI mega tools
add/list/route/explain. Registration is CLI-only; the router only advises
(no execution, no enforcement at a call site). No LLM, no embeddings.
