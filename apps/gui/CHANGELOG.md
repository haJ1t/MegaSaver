# @megasaver/gui

## 1.1.0

### Minor Changes

- 76ebfb8: Add a token-savings trend chart and raw-output retention controls to the
  Mega Saver Mode panel.

  - **Savings chart (3c):** a hand-rolled inline-SVG bar chart (no charting
    dependency) of per-event `savingRatio`, embedded in the token-saver stats
    block. Accessible as `role="img"` with an `aria-label` summarising the trend
    ("Savings trend: N events, avg X%"); empty state when there are no events.
  - **Retention controls (3d):** new bridge routes
    `GET /api/sessions/:id/retention` (chunk-set count, total bytes, oldest
    timestamp), `POST .../retention/clear`, and `POST .../retention/prune`
    ({days}) — all strictly scoped to the session's own stored output via
    `@megasaver/content-store`. The GUI shows the stored-output summary and a
    destructive "Clear stored raw output" action behind an explicit two-click
    in-UI confirm, with the result announced through a polite live region.

### Patch Changes

- @megasaver/content-store@1.0.1
- @megasaver/core@1.0.2
- @megasaver/mcp-bridge@1.0.2
- @megasaver/stats@1.0.1
- @megasaver/connector-generic-cli@1.0.2
- @megasaver/connectors-shared@1.0.2

## 1.0.1

### Patch Changes

- 55d54fb: Fix WCAG 2.1 AA color-contrast (SC 1.4.3) on two GUI active/selected states in
  light mode.

  The active nav item (`bg-accent/15`, `aria-current="page"`) and the active
  segmented "+ New …" chip (`bg-accent/20 border border-accent/30`) labelled
  their text with `text-accent`. Composited over the page background, the amber
  label cleared only 4.03:1 (nav) and 3.75:1 (chip) — below the 4.5:1 normal-text
  threshold. The label colour is now `text-text-primary`, which composites to
  13.6:1 (nav) and 12.6:1 (chip) in light and 13.8:1 / 12.4:1 in dark; every
  state now passes AA in both themes. The accent tint fill, accent border, and
  `font-medium` remain as the selected-state signal (SC 1.4.1 was already met by
  fill + border + weight), so the visual language is unchanged. Component class
  strings only; no token values changed.

- 3e6ad88: Fix WCAG 2.1 AA color-contrast failures in two GUI design tokens.

  `--color-accent` (light) darkened `#c4681a` → `#a25616` so `text-accent`
  (status labels, links, Retry) clears 4.5:1 on every surface and the
  primary button label (white on accent) clears 4.5:1. `--color-text-muted`
  darkened in light `#9ea3ad` → `#646b77` and lightened in dark
  `#565b66` → `#8b909d` so secondary/instruction text clears 4.5:1 in both
  themes. Hue and saturation preserved (warm amber / neutral grey); the dark
  accent already passed AA and is unchanged. CSS token values only.

- Updated dependencies [a2526d3]
  - @megasaver/core@1.0.1
  - @megasaver/connector-generic-cli@1.0.1
  - @megasaver/connectors-shared@1.0.1
  - @megasaver/mcp-bridge@1.0.1

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- 9139ccc: Add the GUI Mega Saver Mode surface (AA1 BB10): TokenSaverPanel
  (enable/disable + mode picker), token-saver modal + stats, and a
  savings badge in the sessions list. New bridge routes under
  `/api/sessions/:id/token-saver/{enable,disable,status,stats,events,events/:eventId/raw,events/:eventId/sent}`.
  The panel renders only on open sessions; ended sessions show no
  mutation surface. Events/raw/sent return empty/null honestly when no
  content-store entries exist (no fabricated stats).
- 0c30651: Ship the final AA1 epic surface (BB11): GUI AgentSetupDoctor + connector
  CONTEXT_GATE block.

  `@megasaver/connectors-shared` gains `renderContextGateBlock` (rendered only
  when `session.tokenSaver?.enabled === true`) plus the `MEGA SAVER:CONTEXT_GATE`
  sentinel constants. `parseBlock(content, sentinels?)` is now parameterised by
  sentinel pair (defaulting to the legacy pair, so every existing caller is
  byte-unaffected) and `upsertBlock` manages the legacy + CONTEXT_GATE blocks in
  one pass.

  `@megasaver/mcp-bridge` hoists `DEFAULT_MCP_COMMAND` / `DEFAULT_MCP_ARGS`
  (`mega` + `["mcp","serve"]`) and threads an optional `args` through
  `buildMcpSetupOps` so the written MCP config is a runnable launch command.

  `@megasaver/gui` adds the Agent setup view (`agent-setup-doctor` +
  `agent-setup-row`), four zod-validated bridge routes under `/api/mcp/*`
  (status/install/repair/uninstall) consuming BB8's `McpSetupOps`, the
  `mcp_setup_failed` bridge error code, api-client methods, and the
  `agent-setup` nav tab. The GUI bridge now writes a runnable `mega mcp serve`
  launch command on install.

  `@megasaver/cli` connector-sync now seeds a brand-new agent file via
  `upsertBlock` (so it also receives the CONTEXT_GATE block when the session has
  Mega Saver Mode enabled); output stays byte-identical for tokenSaver-off
  sessions.

- 0e9be7a: BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
  mega_read_file, mega_recall, mega_run_command), McpBridgeErrorCode
  widened to 16 members, McpToolName closed enum, the
  `mega mcp install/repair/serve/status/uninstall` CLI, and the
  `McpSetupOps` facade (with `aggregateMcpStatus` reporting
  `mcpInstalled`/`connectorSynced`/`restartRequired`/`restartHint`
  per agent) wired into the GUI bridge as the production `mcpOps`.
  Replaces the v0.3 not_implemented placeholder. createBridge API
  preserved (AA1 §2c).

  `mega mcp serve` is the long-running stdio launch entry an agent
  spawns to reach the bridge: it resolves the store + a
  JsonDirectoryCoreRegistry (as `mega output exec` does), starts the
  bridge over stdio, and shuts down cleanly on stdin-EOF / SIGINT /
  SIGTERM. To make the installed config runnable, `installMcp` now
  writes `{ command, args }` (idempotency compares both) and
  `mega mcp install`/`repair` default to `command: "mega"`,
  `args: ["mcp", "serve"]` instead of the unlaunchable `"mega-mcp"`
  literal (gap found by the AA1 §16 live smoke).

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [0c30651]
- Updated dependencies [a8b6531]
- Updated dependencies [6078dc9]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [0e9be7a]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [a3a4401]
- Updated dependencies [a3a4401]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/connectors-shared@1.0.0
  - @megasaver/mcp-bridge@1.0.0
  - @megasaver/content-store@1.0.0
  - @megasaver/stats@1.0.0
  - @megasaver/core@1.0.0
  - @megasaver/connector-generic-cli@1.0.0
