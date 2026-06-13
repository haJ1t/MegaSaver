---
title: Tool Router
tags: [concept, tools, routing, safety, phase-7]
sources:
  - docs/superpowers/specs/2026-06-12-phase7-tool-router-design.md
  - syntheses/contextops-roadmap.md
  - entities/core.md
status: active
created: 2026-06-12
updated: 2026-06-12
---

# Tool Router

Roadmap Phase 7 ("Tool Forge-style MCP Tool Router"). Turn a flat,
ever-growing pile of tool schemas into a task-scoped allow/block
decision with a **dual win**: fewer tokens (only task-relevant tool
schemas enter the agent's context) and safety (dangerous tools are
blocked from a plain task route) — source:
[[syntheses/contextops-roadmap]].

## Advisor, not enforcer

Same architectural fact as the [[concepts/task-engine]]: **Mega Saver
has no agent runtime** and no place where a tool is actually invoked
inside Core. So the Tool Router is a **deterministic recommender**, not
a sandbox or a permission broker — it only *advises* which tools to
expose; the agent/host decides whether to honour the advice.

## Shape

- A **`ToolDefinition`** is a per-project entity describing one tool an
  agent could call: its `category`, its `risk`, and a `keywords`
  retrieval surface. `inputSchema` / `outputSchema` are stored as
  opaque `z.unknown()` JSON — descriptive metadata only; the engine
  never reads or executes them.
- `routeToolsForTask(tools, query)` returns
  `{ allowedTools, blockedTools, reason }`: a small, relevance-ranked
  subset of **safe** tools to load, plus the held-back list.

## The safety half

Dangerous / deploy / database tools are **blocked unconditionally** —
regardless of how well their text matches the task. Relevance ranking
(`rankBm25`) only ever decides which *safe* tools to surface; it can
never promote a dangerous tool.

## Reconciliation with shipped code

Net-new and **done** (PR #120): 1 entity module (`tool-definition.ts`),
1 pure routing module (`tool-router.ts`), a branded `ToolDefinitionId`,
4 `CoreRegistry` methods (`createToolDefinition`, `getToolDefinition`,
`listToolDefinitions`, `routeToolsForTask`) on both backends, 2 error
codes, 1 MCP tool (`route_tools_for_task`; tools 22 → 23), and `mega
tools add/list/route/explain`.

## Related

- [[syntheses/contextops-roadmap]]
- [[concepts/audit-dashboard]] (toolSchemasReduced)
- [[entities/core]], [[entities/policy]] (dangerous-pattern deny)
