# Stack & Commands

## Stack

- Runtime:    Node 22 LTS (`.nvmrc` pinned)
- Language:   TypeScript strict, ESM only
- Package:    pnpm (workspace protocol for internal deps)
- Build:      tsup per-package + Turborepo orchestration
- Test:       Vitest (unit + integration)
- Lint+fmt:   Biome
- Type-check: tsc --noEmit (project references)
- CLI fwk:    Citty (UnJS — modern, ESM-native, typed args)
- Versioning: Changesets

## Commands (from repo root)

```bash
pnpm install
pnpm dev              # turbo dev — watch all
pnpm build            # turbo build — emit dist/
pnpm test             # vitest run (CI mode)
pnpm test:watch
pnpm lint             # biome check
pnpm lint:fix         # biome check --write
pnpm typecheck        # tsc -b --noEmit
pnpm verify           # lint + typecheck + test (DoD gate)
```

## Per-package

```bash
pnpm --filter @megasaver/<pkg> <cmd>
```

Note: pnpm/Turborepo/Biome configuration files are introduced by the
`project-skeleton` spec, not this bootstrap. Until then, the commands
above are aspirational and will activate when the skeleton lands.
