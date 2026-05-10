---
title: PP — Hoist titleSchema plan
spec: docs/superpowers/specs/2026-05-10-pp-titleschema-hoist-design.md
risk: MEDIUM
status: approved
issue: 59
author: executor
date: 2026-05-10
---

# PP — Hoist `titleSchema` plan

## Step 1 — Create canonical module

Create `packages/shared/src/title.ts`. Copy the CLI schema chain
byte-for-byte:

```ts
import { z } from "zod";

// C0/C1 control chars and DEL break the CLI line protocol. U+2028
// (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are also blocked
// because JS engines treat them as line terminators in source text.
// The error message string MUST match NAME_CONTROL_CHARS_MESSAGE in
// apps/cli/src/errors.ts so the CLI error-mapper keeps discriminating
// the regex-failure case by equality.
export const titleSchema = z
  .string()
  .trim()
  .min(1)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f  ]+$/, "title must not contain control characters")
  .transform((value) => value.normalize("NFC"));

export type Title = z.infer<typeof titleSchema>;
```

## Step 2 — Re-export from the shared barrel

Append to `packages/shared/src/index.ts`:

```ts
export * from "./title.js";
```

## Step 3 — Write unit tests (TDD)

Create `packages/shared/test/title.test.ts` covering all §5 cases
in the spec. Use `safeParse` for sad paths and `parse` for happy
paths. Pin the control-char error message string.

## Step 4 — Wire CLI consumer

Edit `apps/cli/src/commands/session/shared.ts`:

- Remove the local `titleSchema` definition.
- Remove the now-unused `NAME_CONTROL_CHARS_MESSAGE` import.
- Add `import { titleSchema } from "@megasaver/shared";`.
- Re-export it so `create.ts` and `update.ts` keep compiling:
  `export { titleSchema } from "@megasaver/shared";`.

## Step 5 — Wire Bridge consumer

Edit `apps/gui/bridge/zod-schemas.ts`:

- Remove the `TITLE_SCHEMA` const.
- Remove the bridge-side comment about mirroring CLI.
- Add `titleSchema` to the existing `@megasaver/shared` import line.
- Rename the two `TITLE_SCHEMA` references inside `CREATE_SESSION_BODY`
  and `PATCH_SESSION_BODY` to `titleSchema`.

## Step 6 — Build the shared package

```bash
pnpm install                                  # ensure workspace links
pnpm --filter @megasaver/shared build
```

Confirms `dist/title.js` and `dist/title.d.ts` are emitted and
`dist/index.js` re-exports them.

## Step 7 — Verify per package

Run in this order so CLI/GUI typecheck sees the freshly built shared:

```bash
pnpm --filter @megasaver/shared test          # new title.test.ts green
pnpm --filter @megasaver/cli typecheck
pnpm --filter @megasaver/cli test             # 301 still pass
pnpm --filter @megasaver/gui typecheck
pnpm --filter @megasaver/gui test             # 165 still pass
```

## Step 8 — Full DoD gate

```bash
pnpm verify                                    # lint + typecheck + test
```

Expected: exit 0, 18/18 tasks, 855+ tests pass.

## Smoke

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/cli.js session create --help                # binary boots
# Optional end-to-end smoke against a fresh store:
TMPDIR=$(mktemp -d)
node apps/cli/dist/cli.js project create demo --store "$TMPDIR"
node apps/cli/dist/cli.js session create demo --agent claude-code \
  --title "smoke from PP" --store "$TMPDIR" --json
# Expect a JSON line with title "smoke from PP" — schema accepted it.
```

## Wiki + log

Append `## [2026-05-10] refactor | PP — hoist titleSchema to @megasaver/shared (#59)`
to `wiki/log.md` (after the latest OO file-split entry), citing the
M2 origin on PR #57.

Update `wiki/entities/shared.md` to list `titleSchema` and `Title`
in the v0.1 public surface.

## Commit

```
refactor(shared): hoist titleSchema from CLI to @megasaver/shared (PP)

Closes #59.

- packages/shared/src/title.ts: canonical titleSchema + Title type
- apps/cli/src/commands/session/shared.ts: import from @megasaver/shared
- apps/gui/bridge/zod-schemas.ts: import from @megasaver/shared
- packages/shared/test/title.test.ts: unit tests for the schema

Behavior preservation: 855+ tests pass. Both consumers now share
the canonical source. Drift risk per code-reviewer M2 on PR #57 closed.

Risk MEDIUM. Cross-package validation surface.
```

## PR

Title: `refactor(shared): hoist titleSchema (PP, closes #59)`.

Body includes:

- Link to #59 and the M2 finding on #57.
- Before/after import sites.
- Verify proof (test counts + DoD exit code).
- Smoke output (binary boots, end-to-end title accepted).
