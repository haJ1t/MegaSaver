---
"@megasaver/gui": minor
"@megasaver/connectors-shared": minor
---

Add workspace-scoped Saver Mode activation to the live GUI. A new "Saver Mode"
workspace tab toggles Mega Saver Mode for a folder by writing the CONTEXT_GATE
block into <cwd>/CLAUDE.md (sentinel-bounded, atomic) and reports MCP-install
status. connectors-shared exposes renderContextGateBlockText +
upsertContextGateBlockText for the render-in-bridge path.
