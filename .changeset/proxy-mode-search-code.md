---
"@megasaver/mcp-bridge": minor
---

Add the `proxy_search_code` MCP tool (Proxy Mode v1.2, Deliverable 5).

Task-aware code search backed by policy-gated `grep` over the live filesystem.
Live grep results are the source of truth: matches are grouped by file, the raw
output is stored in the content-store for expansion (`chunkSetId`), and token
savings metrics are returned. Best-effort BM25 enrichment may reorder the
grouped files (`index_enrichment: "applied"`) but never adds or removes live
matches; when enrichment cannot run it reports `"unavailable"` and the live
grep order is kept. The tool is a new proxy-only name with no `mega_*` twin and
is exposed in both proxy and legacy naming modes.
