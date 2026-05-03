---
date: 2026-05-03
topic: project-skeleton
status: approved
risk: medium
authors:
  - Halit Ozger (haltozger02@gmail.com)
  - Claude Opus 4.7 (1M context)
---

# Mega Saver — Project Skeleton

## 1. Context

Bootstrap (PR #1, merged 2026-05-03) established the agent governance
system: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `docs/conventions/`,
and the wiki vault. Stack decisions are locked in
[`docs/conventions/stack-and-commands.md`](../../conventions/stack-and-commands.md):
Node 22 LTS, TypeScript strict ESM, pnpm workspaces, Turborepo, tsup,
Vitest, Biome, Citty, Changesets.

The `pnpm verify`, `pnpm test`, `pnpm lint`, etc. commands are
declared in the conventions but currently aspirational — no
`package.json`, no `tsconfig.base.json`, no `biome.json`, no
`turbo.json` exist yet. This spec creates the configuration files
that activate those commands.

**This spec covers tooling configuration only.** No package
implementation. No code. The first package (`@megasaver/shared`)
gets its own spec when its types and Zod schemas are designed.

## 2. Goals

1. Land all root-level configuration files so `pnpm install`
   succeeds in a clean checkout.
2. Wire the seven scripts in `package.json` (`dev`, `build`, `test`,
   `test:watch`, `lint`, `lint:fix`, `typecheck`, `verify`, `clean`,
   `changeset`, `version-packages`, `release`) so the `pnpm verify`
   gate from `definition-of-done.md` exists.
3. Pin Node and pnpm versions deterministically (`.nvmrc` +
   `packageManager`) so contributors and CI use the same toolchain.
4. Add a public `LICENSE` (MIT) and a minimal `README.md` so the
   public GitHub repo is presentable.
5. Configure Biome, Turborepo, and Changesets with opinionated
   defaults that match the conventions.

## 3. Non-goals

- No package implementation. `apps/` and `packages/` directories
  remain empty until each package gets its own spec.
- No CI workflow files (`.github/workflows/*`). Deferred to a
  separate spec once a package exists to actually test.
- No path aliases in `tsconfig.base.json`. YAGNI until a package
  needs them.
- No PR template (`.github/pull_request_template.md`). Deferred to
  a small follow-up; current PR template is the conversation-driven
  format used in PR #1.
- No CONTRIBUTING.md / CODE_OF_CONDUCT.md. Deferred to v0.2 when
  the project invites external contributors.
- No `corepack enable` automation. Documented in README only.

## 4. Decisions Matrix

| # | Decision                  | Value                                                                                  |
|---|---------------------------|----------------------------------------------------------------------------------------|
| 1 | Empty package stubs       | None — each package born in its own spec (no half-implementations).                    |
| 2 | License                   | MIT, author "Halit Ozger <haltozger02@gmail.com>", year 2026.                          |
| 3 | README                    | Minimal placeholder (~30 lines) pointing at CLAUDE.md and docs/.                       |
| 4 | Node engine pin           | `engines.node: ">=22.0.0"` and `.nvmrc: "22"`.                                         |
| 5 | pnpm pin (Corepack)       | `packageManager: "pnpm@9.x"` (latest stable 9.x at skeleton-write time).               |
| 6 | tsconfig.base.json extras | Add `composite`, `incremental`, `declaration`, `declarationMap`, `sourceMap`, `outDir: dist`, `rootDir: src`. No path aliases yet. |
| 7 | Biome formatter           | 2-space indent, double quotes, trailing comma `all`, line width 100.                   |
| 8 | Biome linter              | `recommended` + `style` groups on. Ignore `dist`, `build`, `.turbo`, `node_modules`, `wiki/raw`. |
| 9 | Turborepo pipeline        | `build` (^build), `typecheck` (^typecheck), `test` (depends on build), `lint` (parallel), `dev` (persistent, no cache), `clean` (no cache). |
| 10| Changesets config         | Defaults; `baseBranch: main`, `access: restricted` until a package goes public.        |
| 11| Editor config             | `.editorconfig` matching Biome (2 spaces, LF, UTF-8, final newline, trim trailing).    |
| 12| VS Code recommendations   | `.vscode/extensions.json` only (Biome, Vitest). Other VS Code files stay gitignored.   |
| 13| Git config email          | Update from `haltozger0202@gmail.com` to `haltozger02@gmail.com` before skeleton commits. |

## 5. Proposed File Contents

### 5.1 `.nvmrc`

```
22
```

### 5.2 `.npmrc`

```
auto-install-peers=true
strict-peer-dependencies=false
prefer-workspace-packages=true
shamefully-hoist=false
```

### 5.3 `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

### 5.4 `package.json` (root)

```json
{
  "name": "megasaver",
  "private": true,
  "version": "0.0.0",
  "description": "ContextOps platform for frontier coding agents.",
  "type": "module",
  "license": "MIT",
  "author": "Halit Ozger <haltozger02@gmail.com>",
  "homepage": "https://github.com/haJ1t/MegaSaver",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/haJ1t/MegaSaver.git"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "test:watch": "turbo test:watch",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "turbo typecheck",
    "verify": "pnpm lint && pnpm typecheck && pnpm test",
    "clean": "turbo clean && rm -rf node_modules .turbo",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "pnpm build && changeset publish"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@changesets/cli": "^2.27.11",
    "tsup": "^8.3.5",
    "turbo": "^2.3.3",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

> Pin the exact `packageManager` version (e.g. `pnpm@9.15.0`) to
> whatever the latest stable 9.x is at the moment of writing the
> file in the implementation plan — the executor verifies via
> `pnpm --version` and freezes that.

### 5.5 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/connectors/*"
```

### 5.6 `tsconfig.base.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,

    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,

    "composite": true,
    "incremental": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,

    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["node_modules", "dist", "build", ".turbo"]
}
```

### 5.7 `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "ignore": [
      "**/dist",
      "**/build",
      "**/.turbo",
      "**/node_modules",
      "**/coverage",
      "**/.vitest-cache",
      "wiki/raw"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always",
      "arrowParentheses": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useImportType": "error",
        "useNodejsImportProtocol": "error"
      }
    }
  },
  "organizeImports": {
    "enabled": true
  }
}
```

### 5.8 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "globalEnv": ["NODE_ENV"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": ["*.tsbuildinfo"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "test:watch": {
      "dependsOn": ["build"],
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

### 5.9 `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### 5.10 `LICENSE`

```
MIT License

Copyright (c) 2026 Halit Ozger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 5.11 `README.md`

```markdown
# Mega Saver

> ContextOps platform for frontier coding agents.

**Status:** v0.1 in development. No installable artifacts yet.

Mega Saver connects to Claude Code, Codex, Cursor, Aider, and any
CLI agent. It manages context, memory, sessions, and token
efficiency from one control panel. _Less tokens. More signal.
Same or better agent performance._

## Where to read

- [`CLAUDE.md`](CLAUDE.md) — project conventions and discipline (canonical for Claude Code).
- [`AGENTS.md`](AGENTS.md) — Codex governance.
- [`docs/conventions/`](docs/conventions) — single source of truth for all rules.
- [`docs/superpowers/specs/`](docs/superpowers/specs) — design specs.
- [`docs/superpowers/plans/`](docs/superpowers/plans) — implementation plans.

## Develop

Requirements: Node 22 LTS and pnpm 9.x (Corepack-managed).

```bash
corepack enable
pnpm install
pnpm verify   # lint + typecheck + test
```

## License

MIT — see [`LICENSE`](LICENSE).
```

### 5.12 `.vscode/extensions.json`

```json
{
  "recommendations": [
    "biomejs.biome",
    "vitest.explorer",
    "editorconfig.editorconfig"
  ]
}
```

### 5.13 `.gitignore` update (to allow `.vscode/extensions.json` through)

The current `.gitignore` already allows `.vscode/extensions.json`
via `!.vscode/extensions.json`. Verify the line is present; no
change required if it is.

## 6. Open Questions / Followups

1. **Exact pnpm version** — `pnpm@9.15.0` is a placeholder. Plan
   executor must pin the latest stable 9.x available at
   implementation time and freeze that exact version.
2. **Biome rule tuning** — the proposed config is intentionally
   light. Once the first package lands, expect a follow-up
   `chore(lint):` PR adjusting rules based on real code.
3. **CI workflow** — `.github/workflows/ci.yml` deferred. Once
   `@megasaver/shared` exists with at least one test, a separate
   `ci` spec lands the workflow.
4. **PR template** — deferred. The conventional-commits + CLAUDE.md
   reference are sufficient until external contributors arrive.
5. **Renovate / Dependabot** — deferred to v0.2.
6. **Corepack auto-enable** — README documents the manual step. A
   future `chore` could add a `prepare` script in root.

## 7. Risk Assessment

**MEDIUM.**

Foundation tooling. Mistakes propagate to every package and every
CI run. Reversible with low cost (config-only edits) but discovered
late they cost re-runs. No code, no production data, no user
files touched.

Per `risk-modes.md`, MEDIUM mandates the full superpowers chain
plus `code-reviewer`. This spec satisfies the brainstorming step.
The implementation plan handles writing-plans → TDD-N/A →
verification → review.

## 8. Verification Plan

After the implementation plan completes:

- [ ] `pnpm install` succeeds in a fresh clone (no errors, no
  missing-package warnings).
- [ ] `pnpm verify` runs end-to-end. With zero packages, the test
  step is a no-op (turbo finds no `test` task in any workspace),
  lint scans only root files, typecheck no-ops. Exit code 0.
- [ ] `pnpm lint` formats and lints only root-level files (no
  package.json files exist yet to scan).
- [ ] `node --version` matches `.nvmrc` (22.x).
- [ ] `pnpm --version` matches `package.json` `packageManager`
  field exactly.
- [ ] `git config user.email` is `haltozger02@gmail.com` BEFORE
  any commit on this branch.
- [ ] LICENSE shows MIT and the correct author email.
- [ ] README displays correctly on GitHub (no broken markdown).
- [ ] `.vscode/extensions.json` tracked; other `.vscode/*` ignored.
- [ ] All 13 deliverable files committed in atomic logical groups
  (proposed: one commit for tooling config, one for license+readme,
  one for editor/vscode).
- [ ] `code-reviewer` agent passes the bootstrap PR (no CRITICAL,
  no MAJOR).
- [ ] `verifier` agent confirms DoD items 1–7 applicable items.

## 9. Next Step

After spec approval:

1. `superpowers:writing-plans` → executable step plan.
2. Execute via `superpowers:executing-plans` (inline mode, same as
   bootstrap).
3. Worktree: `feat/project-skeleton`.
4. Commits: atomic groups (config + license/readme + vscode).
5. PR + reviewer pass + merge.

Subsequent specs (out of scope here):

1. `2026-XX-XX-shared-package` — `@megasaver/shared` types and Zod
   schemas. First real package.
2. `2026-XX-XX-token-audit` — first Core feature.
3. `2026-XX-XX-cli-skeleton` — `mega init`, `mega project add`.
4. `2026-XX-XX-claude-code-connector-v1`.
5. `2026-XX-XX-generic-cli-connector-v1`.
6. `2026-XX-XX-ci-workflow` — once a real package has a real test.
