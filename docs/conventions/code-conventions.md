# Code Conventions

## TypeScript

- `strict: true` (all strict flags on)
- `moduleResolution: NodeNext`
- `module: NodeNext` (ESM only)
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `isolatedModules: true`
- `skipLibCheck: true`
- `target: ES2023`

Project references for monorepo. Each package its own `tsconfig.json`
extending `tsconfig.base.json`.

## File organization

- One responsibility per file. Split when file exceeds 300 LOC OR
  serves more than one concern.
- One package = one bounded context. Cross-package import only
  through public entry (`package.json` `exports`).
- No circular imports. Depcheck in CI.
- `index.ts` re-exports only the public surface.

## Boundaries

- Validate input at system boundaries (CLI args, file reads,
  external API responses, MCP messages).
- Trust internal code. No defensive checks for impossible cases.
- Use Zod schemas for all external boundaries. Generated types,
  not hand-written.

## Comments

- Default: no comments. Names carry meaning.
- Exception: WHY non-obvious (constraint, invariant, workaround,
  surprising behavior).
- Never: "what" comments, "added for X flow", "used by Y".

## Abstraction

- 3 similar lines > premature abstraction.
- No half-implementations.
- No fallbacks for impossible cases.
- No backward-compat shims while pre-1.0.

## Naming

- packages: `@megasaver/<name>` (kebab-case)
- files:    `kebab-case.ts`
- types:    `PascalCase`
- vars/fns: `camelCase`
- consts:   `SCREAMING_SNAKE_CASE` only for true constants
            (env keys, magic numbers)
