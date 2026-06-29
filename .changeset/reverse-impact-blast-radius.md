---
"@megasaver/context-pruner": minor
"@megasaver/mcp-bridge": minor
---

Add reverse call-graph blast-radius selection (`buildImpactPack` /
`selectImpact`) and expose it as the `mega_impact` MCP tool. Given an edited
symbol, the reverse BFS over `calledBy` returns the symbol plus every
transitive caller affected by changing it, under the existing context-pruner
token budget + reasons machinery. The closure is exhaustive within budget — a
caller cut by budget is reported in `excluded`, never silently dropped — and an
unknown symbol yields an empty pack. Tool-resident, so it works over MCP on
Claude Desktop.
