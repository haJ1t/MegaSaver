# Repo Layout

Monorepo. pnpm workspaces. Turborepo for orchestration.

```
MegaSaver/
├─ apps/
│  ├─ cli/                    # `mega` command — entrypoint
│  └─ gui/                    # desktop control panel
├─ packages/
│  ├─ core/                   # Core Engine
│  ├─ shared/                 # Types, schemas, utilities
│  ├─ connectors/             # one thin adapter per agent
│  └─ …                       # see `packages/` on disk
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

This tree is structural only. `packages/` on disk is the authority
for the package list — `conventions:check` cannot verify names here
against reality, so do not treat an omission as "does not exist".
