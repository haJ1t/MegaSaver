---
"@megasaver/mcp-bridge": minor
"@megasaver/connectors-shared": minor
---

Proxy Mode v1.2 tool naming mode. `MEGASAVER_TOOL_NAMING=proxy|legacy`
(default proxy) controls the MCP `tools/list` surface: proxy mode
exposes `proxy_read_file` / `proxy_run_command` / `proxy_expand_chunk`,
legacy mode keeps the `mega_*` names — never both at once, so no
duplicate tool schemas. Both modes dispatch to the same
implementation. `mega_recall` is unchanged. The Context Gate connector
block now emits the proxy default names.
