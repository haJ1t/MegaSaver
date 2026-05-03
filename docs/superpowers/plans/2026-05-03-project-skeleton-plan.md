# Project Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all root-level configuration so `pnpm install` and `pnpm verify` succeed in a clean checkout.

**Architecture:** Single source of truth for tooling: one `package.json`, one `tsconfig.base.json`, one `biome.json`, one `turbo.json`, one `.changeset/config.json`, one `pnpm-workspace.yaml`. No package implementations — `apps/` and `packages/` stay empty until each package gets its own spec. The MIT license and a minimal README make the public repo presentable.

**Tech Stack:** Node 22 LTS, pnpm 9.x via Corepack, TypeScript 5.7, Turborepo 2.x, Biome 1.9.x, Vitest 2.x, tsup 8.x, Changesets 2.x.

**Spec:** [`docs/superpowers/specs/2026-05-03-project-skeleton-design.md`](../specs/2026-05-03-project-skeleton-design.md)

**Risk:** MEDIUM (per spec §7).

---

## File Structure (deliverables)

```
MegaSaver/
├─ .nvmrc                          (Task 2.1)
├─ .npmrc                          (Task 2.2)
├─ .editorconfig                   (Task 2.3)
├─ package.json                    (Task 2.4)
├─ pnpm-workspace.yaml             (Task 2.5)
├─ tsconfig.base.json              (Task 2.6)
├─ biome.json                      (Task 2.7)
├─ turbo.json                      (Task 2.8)
├─ .changeset/
│  └─ config.json                  (Task 2.9)
├─ LICENSE                         (Task 3.1)
├─ README.md                       (Task 3.2)
└─ .vscode/
   └─ extensions.json              (Task 4.1)
```

Total: 12 new files. Atomic commit groups: tooling (Task 2), license+readme (Task 3), vscode (Task 4).

---

## Pre-flight

### Task 0: Worktree + git config + pnpm version pin

**Files:** none (env setup)

- [ ] **Step 1: Confirm we are on `main` at the spec commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver
git status
git log --oneline -3
```

Expected: clean tree, top commit `ef4c207 docs(specs): brainstorm project-skeleton`.

- [ ] **Step 2: Update git config email for this repo**

```bash
git -C /Users/halitozger/Desktop/MegaSaver config user.email "haltozger02@gmail.com"
git -C /Users/halitozger/Desktop/MegaSaver config user.email
```

Expected output: `haltozger02@gmail.com`

- [ ] **Step 3: Create the feature worktree**

```bash
git -C /Users/halitozger/Desktop/MegaSaver worktree add -b feat/project-skeleton /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton main
```

Expected: worktree directory exists, branch `feat/project-skeleton` checked out at the same commit as `main`.

- [ ] **Step 4: Resolve the exact pnpm 9.x version to pin**

The spec uses `pnpm@9.15.0` as a placeholder. Pin the latest stable 9.x available at execution time.

```bash
npx --yes pnpm@latest-9 --version
```

Record the output (e.g. `9.15.4`). Use this exact string in `package.json` at Task 2.4.

If `npx` is unavailable or the registry is offline, fall back to the placeholder `9.15.0` and note this in the commit message.

- [ ] **Step 5: Confirm Node ≥ 22**

```bash
node --version
```

Expected: `v22.x.y` or higher. If lower, install Node 22 LTS before proceeding (the worktree's `.nvmrc` will tell `nvm use 22` to switch once Task 2.1 lands; for now we just need the binary to satisfy install).

> **All tasks below run in the worktree at `/Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/`.** Use `git -C <path>` or `cd` consistently.

---

## Task 1: Resolve and lock the pnpm version

**Files:** none (decision recorded for Task 2.4)

- [ ] **Step 1: Capture the resolved pnpm version**

Set a shell variable for the rest of the session:

```bash
PNPM_VERSION=$(npx --yes pnpm@latest-9 --version 2>/dev/null || echo "9.15.0")
echo "Resolved pnpm version: $PNPM_VERSION"
```

Use `$PNPM_VERSION` (or substitute the literal string) wherever the plan says `<PNPM_VERSION>`.

---

## Task 2: Tooling config files (single atomic commit)

Nine files. Single commit at the end. Order is filesystem-only — Bash `mkdir`, then Write each file, then verify, then commit.

### Task 2.0: Create `.changeset/` directory

**Files:**
- Create: `.changeset/` (directory)

- [ ] **Step 1: Make the dir**

```bash
mkdir -p /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/.changeset
```

Expected: directory exists, empty.

### Task 2.1: `.nvmrc`

**Files:**
- Create: `.nvmrc`

- [ ] **Step 1: Write the file**

```
22
```

(Single-line file containing only the number `22`. No trailing comment.)

- [ ] **Step 2: Verify**

```bash
cat /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/.nvmrc
```

Expected: `22`

### Task 2.2: `.npmrc`

**Files:**
- Create: `.npmrc`

- [ ] **Step 1: Write the file**

```
auto-install-peers=true
strict-peer-dependencies=false
prefer-workspace-packages=true
shamefully-hoist=false
```

- [ ] **Step 2: Verify**

```bash
test -f /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/.npmrc && head -4 /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/.npmrc
```

Expected output: those four lines.

### Task 2.3: `.editorconfig`

**Files:**
- Create: `.editorconfig`

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Verify**

```bash
test -f /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/.editorconfig && head -3 /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/.editorconfig
```

Expected first three lines:

```
root = true

[*]
```

### Task 2.4: `package.json` (root)

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write the file**

Substitute `<PNPM_VERSION>` with the value resolved in Task 1 (e.g. `9.15.4`).

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
  "packageManager": "pnpm@<PNPM_VERSION>",
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

- [ ] **Step 2: Verify the file is valid JSON**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && node --eval "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

- [ ] **Step 3: Verify the packageManager line carries the resolved version**

```bash
grep packageManager /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/package.json
```

Expected: `"packageManager": "pnpm@9.x.y",` (with x.y matching what Task 1 captured).

### Task 2.5: `pnpm-workspace.yaml`

**Files:**
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Write the file**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/connectors/*"
```

- [ ] **Step 2: Verify**

```bash
cat /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/pnpm-workspace.yaml
```

Expected: those four lines.

### Task 2.6: `tsconfig.base.json`

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Verify valid JSON**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && node --eval "JSON.parse(require('fs').readFileSync('tsconfig.base.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

### Task 2.7: `biome.json`

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Verify valid JSON**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && node --eval "JSON.parse(require('fs').readFileSync('biome.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

### Task 2.8: `turbo.json`

**Files:**
- Create: `turbo.json`

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Verify valid JSON**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && node --eval "JSON.parse(require('fs').readFileSync('turbo.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

### Task 2.9: `.changeset/config.json`

**Files:**
- Create: `.changeset/config.json`

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Verify valid JSON**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && node --eval "JSON.parse(require('fs').readFileSync('.changeset/config.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

### Task 2.10: Verify Task 2 deliverables

- [ ] **Step 1: List all 9 files**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && ls -la .nvmrc .npmrc .editorconfig package.json pnpm-workspace.yaml tsconfig.base.json biome.json turbo.json .changeset/config.json
```

Expected: all 9 present, none empty.

### Task 2.11: Commit Task 2

- [ ] **Step 1: Stage and commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && git add .nvmrc .npmrc .editorconfig package.json pnpm-workspace.yaml tsconfig.base.json biome.json turbo.json .changeset/config.json && git commit -m "$(cat <<'EOF'
chore: scaffold pnpm workspace + tooling configs

Land all root-level tooling configuration so pnpm install and
pnpm verify succeed in a clean checkout. No package implementations
yet; apps/ and packages/ remain empty until each package's own spec.

- .nvmrc, .npmrc — Node 22 + pnpm-strict resolver settings
- package.json — root scripts (dev/build/test/lint/typecheck/verify)
  + Corepack-pinned pnpm version + Node engine constraint
- pnpm-workspace.yaml — apps/*, packages/*, packages/connectors/*
- tsconfig.base.json — strict + ESM + project references
- biome.json — format + lint, opinionated minimal
- turbo.json — build/typecheck/test/lint/dev/clean pipeline
- .changeset/config.json — restricted access until first public package

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify commit landed**

```bash
git -C /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton log --oneline -1
```

Expected: subject `chore: scaffold pnpm workspace + tooling configs`.

---

## Task 3: License + README (single atomic commit)

### Task 3.1: `LICENSE`

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Verify**

```bash
head -3 /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/LICENSE
```

Expected:

```
MIT License

Copyright (c) 2026 Halit Ozger
```

### Task 3.2: `README.md`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Verify**

```bash
head -3 /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/README.md
```

Expected:

```
# Mega Saver

> ContextOps platform for frontier coding agents.
```

### Task 3.3: Commit Task 3

- [ ] **Step 1: Stage and commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && git add LICENSE README.md && git commit -m "$(cat <<'EOF'
docs: add MIT LICENSE and minimal README

Public repo needs a license to be legally usable; MIT chosen for
permissive baseline. Minimal README points contributors at CLAUDE.md
and docs/ rather than duplicating product copy that does not yet
have an implementation behind it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton log --oneline -1
```

Expected: subject `docs: add MIT LICENSE and minimal README`.

---

## Task 4: VS Code recommendations (single atomic commit)

### Task 4.1: `.vscode/extensions.json`

**Files:**
- Create: `.vscode/extensions.json`

- [ ] **Step 1: Make the dir**

```bash
mkdir -p /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/.vscode
```

- [ ] **Step 2: Write the file**

```json
{
  "recommendations": [
    "biomejs.biome",
    "vitest.explorer",
    "editorconfig.editorconfig"
  ]
}
```

- [ ] **Step 3: Verify valid JSON**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && node --eval "JSON.parse(require('fs').readFileSync('.vscode/extensions.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

- [ ] **Step 4: Verify .gitignore exception lets this file through**

```bash
git -C /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton check-ignore -v .vscode/extensions.json && echo "FAIL: file is ignored" || echo "OK: file is trackable"
```

Expected: `OK: file is trackable` (the existing `.gitignore` line `!.vscode/extensions.json` carves out the exception).

### Task 4.2: Commit Task 4

- [ ] **Step 1: Stage and commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && git add .vscode/extensions.json && git commit -m "$(cat <<'EOF'
chore: add VS Code extension recommendations

Biome, Vitest explorer, EditorConfig — the three extensions that
match this repo's tooling. .gitignore already carves an exception
for .vscode/extensions.json; other VS Code workspace files stay
ignored.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify commit**

```bash
git -C /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton log --oneline -1
```

Expected: subject `chore: add VS Code extension recommendations`.

---

## Task 5: Sanity check — `pnpm install` + `pnpm verify`

The whole point of this PR is that these commands work. Verify before review.

### Task 5.1: Enable Corepack and install

- [ ] **Step 1: Ensure Corepack is on**

```bash
corepack enable
```

(May require `sudo` on some systems. If the user must do this manually, surface it and pause.)

- [ ] **Step 2: Run pnpm install in the worktree**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && pnpm install
```

Expected: pnpm downloads turbo, biome, typescript, tsup, vitest, @changesets/cli into root `node_modules/`. Workspace resolves zero internal packages (apps/ and packages/ are empty). No errors. Possible warnings about unused workspace dirs — acceptable.

If exit code ≠ 0: stop, capture the error, surface to user. Do NOT mask with `|| true`.

- [ ] **Step 3: Verify pnpm version matches packageManager pin**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && pnpm --version
```

Compare against the `packageManager` line in `package.json`. If they diverge, Corepack will already have warned during install. The numbers should match exactly.

### Task 5.2: Run `pnpm verify`

- [ ] **Step 1: Run the verify gate**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && pnpm verify
```

Expected behavior:

- `pnpm lint` → biome scans root files (the json/yaml/markdown configs we just wrote, plus existing CLAUDE.md / AGENTS.md etc.). Should pass clean. If biome flags formatting nits, run `pnpm lint:fix` and re-stage.
- `pnpm typecheck` → turbo finds no `typecheck` task in any workspace package (none exist). Turbo prints "No tasks were executed as part of this run" or similar. Exit 0.
- `pnpm test` → same as typecheck: no `test` tasks exist. Exit 0.

Combined exit code: 0.

- [ ] **Step 2: If lint failed, fix and re-commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && pnpm lint:fix
git status
```

If files were modified: stage and commit with `chore(lint): apply biome fixes`. Then re-run Step 1.

- [ ] **Step 3: Capture verification evidence (for DoD)**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && pnpm verify 2>&1 | tail -30
```

Save the tail output (it goes into the PR description as smoke evidence per DoD §9 step 5).

### Task 5.3: If a lockfile was generated, commit it

- [ ] **Step 1: Check if `pnpm-lock.yaml` was created**

```bash
ls /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/pnpm-lock.yaml
```

If present:

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && git add pnpm-lock.yaml && git commit -m "$(cat <<'EOF'
chore: lock pnpm dependencies

Lockfile generated by first pnpm install on the skeleton config.
Commit deterministic dependency graph so CI and contributors
resolve the same versions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If absent (no real workspace deps to lock): no commit needed, move on.

---

## Task 6: Verification pass

### Task 6.1: Manual checks

- [ ] **Step 1: All deliverables present**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && ls -la .nvmrc .npmrc .editorconfig package.json pnpm-workspace.yaml tsconfig.base.json biome.json turbo.json .changeset/config.json LICENSE README.md .vscode/extensions.json
```

Expected: all 12 present.

- [ ] **Step 2: Branch state**

```bash
git -C /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton log --oneline feat/project-skeleton...main
```

Expected: 3-4 commits (Task 2 tooling, Task 3 license+readme, Task 4 vscode, optionally Task 5.3 lockfile).

- [ ] **Step 3: Tracked file set is clean**

```bash
git -C /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton ls-files | grep -E '\.DS_Store|node_modules|\.env$' || echo "clean"
```

Expected: `clean`.

### Task 6.2: Reviewer agent

- [ ] **Step 1: Dispatch `code-reviewer`**

Invoke once, fresh context. Use the Agent tool with `subagent_type: oh-my-claudecode:code-reviewer`. Prompt:

```
Review the Mega Saver project-skeleton branch `feat/project-skeleton` at
`/Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/`.

Spec:  docs/superpowers/specs/2026-05-03-project-skeleton-design.md
Plan:  docs/superpowers/plans/2026-05-03-project-skeleton-plan.md

This PR lands tooling configuration only. No package implementations.

Check (severity-rated, file:line refs):

1. Decision matrix — does every decision in spec §4 land in a deliverable?
2. File contents — do the 12 files match spec §5 verbatim (allow for the
   resolved pnpm version pin in package.json)?
3. JSON validity — are package.json, tsconfig.base.json, biome.json,
   turbo.json, .changeset/config.json, .vscode/extensions.json all valid
   JSON?
4. Conventional commits — subjects ≤50 chars, valid types, bodies explain
   WHY?
5. Drift vs conventions — does the package.json scripts list match
   docs/conventions/stack-and-commands.md exactly? Any divergence is
   either a drift bug or a needed update to conventions (flag both).
6. README — does it match spec §5.11 and not over-promise (no install
   examples that fail, no usage examples for code that does not exist)?
7. License — author email "haltozger02@gmail.com", year 2026, MIT
   verbatim?

Approve only if 0 CRITICAL and 0 MAJOR.
```

- [ ] **Step 2: Address any MAJOR/CRITICAL findings**

If any: fix inline, commit as `fix(skel): <description>`, re-dispatch reviewer. MINOR/NIT can land in the PR or be deferred — annotate in the PR body.

### Task 6.3: Verifier agent

- [ ] **Step 1: Dispatch `verifier`**

Use the Agent tool with `subagent_type: oh-my-claudecode:verifier`. Prompt:

```
Verify Mega Saver project-skeleton branch `feat/project-skeleton` at
`/Users/halitozger/Desktop/MegaSaver-feat-project-skeleton/` meets the
applicable Definition of Done items (see docs/conventions/definition-of-done.md).

Risk: MEDIUM (spec §7).

Verify each:

1. Spec exists, status: approved.
2. Plan exists.
3. TDD — N/A for tooling configs (no test code).
4. `pnpm verify` green:
   - Run: `cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && pnpm verify`
   - Expected exit 0; report stderr if non-zero.
5. Smoke evidence:
   - `pnpm install` succeeded (Task 5.1).
   - `pnpm --version` matches packageManager pin in package.json.
6. Reviewer agent pass — did Task 6.2 produce APPROVE with 0 CRITICAL/MAJOR?
   (Only YOU know — check the reviewer output the operator provides.
    If not provided, flag as missing evidence.)
7. Zero pending TodoWrite items for this feature.
8. Changeset — N/A (no public package surface yet).
9. Agent files updated if conventions changed — should be N/A; flag if
   anything in docs/conventions/ shifted.

Output: per-item pass/fail/N/A + one-line evidence. End with verdict:
SKELETON READY TO MERGE or BLOCKED: <summary>.
```

- [ ] **Step 2: Confirm pass**

If verifier reports BLOCKED: address each item before proceeding. If READY: continue to Task 7.

---

## Task 7: Open the PR

### Task 7.1: Push the branch

- [ ] **Step 1: Push**

```bash
git -C /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton push -u origin feat/project-skeleton
```

Expected: branch creation on remote, no errors.

### Task 7.2: Create the PR

- [ ] **Step 1: Open PR via gh**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton && gh pr create --base main --head feat/project-skeleton --title "Project skeleton: pnpm workspace + tooling configs" --body "$(cat <<'EOF'
## Summary

Foundation tooling. Lands all root-level configuration so a clean checkout supports `pnpm install` and `pnpm verify`.

- `.nvmrc`, `.npmrc`, `.editorconfig`
- Root `package.json` with pinned Node engine, Corepack-locked pnpm version, and the seven scripts referenced by `docs/conventions/stack-and-commands.md`
- `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `turbo.json`, `.changeset/config.json`
- `LICENSE` (MIT) and minimal `README.md`
- `.vscode/extensions.json` (Biome, Vitest, EditorConfig)

Implements [`docs/superpowers/specs/2026-05-03-project-skeleton-design.md`](docs/superpowers/specs/2026-05-03-project-skeleton-design.md) per [`docs/superpowers/plans/2026-05-03-project-skeleton-plan.md`](docs/superpowers/plans/2026-05-03-project-skeleton-plan.md).

**Risk:** MEDIUM (foundation tooling; no code, no user-facing changes).

## Verification

- ✅ `pnpm install` clean.
- ✅ `pnpm verify` exit 0 (no packages exist yet, so lint runs on root files; typecheck and test no-op).
- ✅ `code-reviewer` agent: APPROVE.
- ✅ `verifier` agent: SKELETON READY TO MERGE.
- N/A TDD — tooling-only feature.

## Test plan

- [ ] Pull branch, run `corepack enable && pnpm install`, confirm zero errors.
- [ ] Run `pnpm verify` locally, confirm exit 0.
- [ ] Confirm `node --version` ≥ 22 and `pnpm --version` matches `packageManager`.
- [ ] Spot-check JSON files parse (`node --eval "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`).
- [ ] Confirm README renders correctly on GitHub.

## Notes

- Empty `apps/` and `packages/` are intentional — each package gets its own brainstorm/spec/plan cycle. Next spec: `@megasaver/shared`.
- Open spec questions deferred: CI workflow (lands once a real package has a real test), PR template, Renovate/Dependabot, Corepack auto-enable in `prepare`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Capture PR URL**

`gh pr create` prints the URL. Surface it to the user.

---

## Task 8: Post-merge cleanup (after user merges PR)

Same shape as the bootstrap closeout. Run only after the user confirms the PR merged.

- [ ] **Step 1: Pull merged main**

```bash
git -C /Users/halitozger/Desktop/MegaSaver fetch origin --prune && git -C /Users/halitozger/Desktop/MegaSaver pull --ff-only origin main
```

- [ ] **Step 2: Remove worktree**

```bash
git -C /Users/halitozger/Desktop/MegaSaver worktree remove /Users/halitozger/Desktop/MegaSaver-feat-project-skeleton
```

- [ ] **Step 3: Delete local branch**

```bash
git -C /Users/halitozger/Desktop/MegaSaver branch -d feat/project-skeleton
```

- [ ] **Step 4: Delete remote branch**

```bash
git -C /Users/halitozger/Desktop/MegaSaver push origin --delete feat/project-skeleton
```

- [ ] **Step 5: Append wiki log entry**

Edit `wiki/log.md` and append:

```
## [YYYY-MM-DD] schema | project-skeleton PR #N merged into main

PR <https://github.com/haJ1t/MegaSaver/pull/N> merged. Main now carries pnpm workspace + tooling configs (12 files). Empty apps/ and packages/ remain; first real package (@megasaver/shared) lands in next spec.
```

Substitute `N` (PR number) and `YYYY-MM-DD` (today).

Commit:

```bash
git -C /Users/halitozger/Desktop/MegaSaver add wiki/log.md && git -C /Users/halitozger/Desktop/MegaSaver commit -m "docs(wiki): log skeleton merge" && git -C /Users/halitozger/Desktop/MegaSaver push origin main
```

---

## Self-Review Checklist (after writing this plan)

- **Spec coverage:** Every decision in spec §4 (13 rows) → deliverable in this plan? Verified:
  - #1 zero stubs → no Task creates stub packages ✓
  - #2 LICENSE → Task 3.1 ✓
  - #3 README → Task 3.2 ✓
  - #4 Node engine + .nvmrc → Task 2.1 + 2.4 ✓
  - #5 pnpm pin → Task 1 + 2.4 ✓
  - #6 tsconfig extras → Task 2.6 ✓
  - #7 Biome formatter → Task 2.7 ✓
  - #8 Biome linter → Task 2.7 ✓
  - #9 Turbo pipeline → Task 2.8 ✓
  - #10 Changesets config → Task 2.9 ✓
  - #11 .editorconfig → Task 2.3 ✓
  - #12 .vscode/extensions.json → Task 4.1 ✓
  - #13 git config email update → Task 0 step 2 ✓
- **Placeholder scan:** Only `<PNPM_VERSION>` placeholder present, with explicit resolve step in Task 1 (not a "TBD" — a deferred-resolution token with a concrete fallback). All other content is literal.
- **Type consistency:** N/A — no TypeScript code in this plan, only config files. JSON validity is checked at write time.

## Open Items After Execution

These remain open per spec §6:

1. Exact pnpm version recorded in `package.json` — set at Task 1 execution time.
2. Biome rule tuning — follow-up after first package lands.
3. CI workflow — separate spec, lands when first test exists.
4. PR template — deferred.
5. Renovate / Dependabot — v0.2.
6. Corepack auto-enable via `prepare` script — chore follow-up.
