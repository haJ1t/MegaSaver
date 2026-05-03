# Repo Layout

Monorepo. pnpm workspaces. Turborepo for orchestration.

```
MegaSaver/
├─ apps/
│  └─ cli/                    # `mega` command — entrypoint
├─ packages/
│  ├─ core/                   # Core Engine
│  ├─ mcp-bridge/             # MCP server (deferred; v0.2)
│  ├─ connectors/
│  │  ├─ claude-code/         # First connector (v0.1)
│  │  └─ generic-cli/         # CLI wrapper (v0.1)
│  ├─ skill-packs/            # Skill pack templates (v0.2)
│  └─ shared/                 # Types, schemas, utilities
├─ docs/
│  ├─ conventions/            # Single source of truth
│  └─ superpowers/
│     ├─ specs/
│     └─ plans/
├─ .changeset/
├─ .github/
├─ CLAUDE.md
├─ AGENTS.md
└─ .cursor/
   └─ rules/
```

`mcp-bridge` and `skill-packs` directories are placeholders deferred
to v0.2; do not add to the workspace until their own spec lands.
