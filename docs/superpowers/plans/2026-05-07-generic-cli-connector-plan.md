# Generic CLI Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@megasaver/connector-generic-cli` (manifest-driven, v0.1 target = Codex `AGENTS.md`) plus a new shared helper package `@megasaver/connectors-shared`, refactoring `@megasaver/connector-claude-code` to consume the shared helpers without changing its public surface or rendered output.

**Architecture:** Three-package change. `connectors-shared` extracts block render/parse/upsert/remove + context schema + filesystem helpers; both connectors depend on it. Claude-code becomes a thin wrapper over shared. Generic-cli is a new wrapper that drives shared via `ConnectorTarget` manifests; v0.1 ships `codexTarget` only.

**Tech Stack:** TypeScript ESM, Zod schemas, Vitest, tsup builds, pnpm workspaces, Turborepo. No CLI integration in this plan (library-only, claude-code precedent).

**Spec:** `docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md` (HIGH risk).

**Branch / worktree:** `feat/generic-cli-connector` at `.worktrees/generic-cli-connector`.

---

## Pre-flight

All commands assume CWD = worktree root: `/Users/halitozger/Desktop/MegaSaver/.worktrees/generic-cli-connector`.

Use `pnpm install` once after T2, T20, and any `package.json` change.

Test commands:
- per package: `pnpm --filter <pkg> test` (single run)
- per package typecheck: `pnpm --filter <pkg> typecheck`
- workspace lint: `pnpm exec biome check`
- workspace lint+fix: `pnpm exec biome check --write`
- DoD gate: `pnpm verify`

---

## Task 1: Extend `AgentId` enum to include `"codex"`

**Files:**
- Modify: `packages/shared/src/agent-id.ts`
- Test: `packages/shared/test/agent-id.test.ts`
- Modify (changeset): create `.changeset/agent-id-add-codex.md`

- [ ] **Step 1: Read current state**

```bash
cat packages/shared/src/agent-id.ts
cat packages/shared/test/agent-id.test.ts
```

Expected: `agentIdSchema = z.enum(["claude-code", "generic-cli"])`. Existing test asserts the union.

- [ ] **Step 2: Write failing test**

Append to `packages/shared/test/agent-id.test.ts`:

```ts
it("accepts the codex agent id", () => {
  expect(agentIdSchema.parse("codex")).toBe("codex");
});
```

- [ ] **Step 3: Run test, expect FAIL**

```bash
pnpm --filter @megasaver/shared test
```

Expected: the new test fails with a `ZodError` because `"codex"` is not yet in the enum.

- [ ] **Step 4: Extend enum**

Edit `packages/shared/src/agent-id.ts`:

```ts
import { z } from "zod";

export const agentIdSchema = z.enum(["claude-code", "codex", "generic-cli"]);
export type AgentId = z.infer<typeof agentIdSchema>;
```

- [ ] **Step 5: Run test, expect PASS**

```bash
pnpm --filter @megasaver/shared test
pnpm --filter @megasaver/shared typecheck
```

Both green.

- [ ] **Step 6: Add changeset**

Create `.changeset/agent-id-add-codex.md`:

```md
---
"@megasaver/shared": patch
---

Add `codex` to the `AgentId` enum so the upcoming generic-cli connector
target can carry its own agent identity instead of collapsing into
`generic-cli`.
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/agent-id.ts packages/shared/test/agent-id.test.ts .changeset/agent-id-add-codex.md
git commit -m "feat(shared): add codex agent id"
```

---

## Task 2: Scaffold `@megasaver/connectors-shared`

**Files:**
- Create: `packages/connectors/shared/package.json`
- Create: `packages/connectors/shared/tsconfig.json`
- Create: `packages/connectors/shared/tsconfig.test.json`
- Create: `packages/connectors/shared/tsup.config.ts`
- Create: `packages/connectors/shared/vitest.config.ts`
- Create: `packages/connectors/shared/src/index.ts`
- Modify (workspace): `pnpm-workspace.yaml` (no change expected if pattern is `packages/*`/`packages/connectors/*`; verify)

- [ ] **Step 1: Verify workspace glob coverage**

```bash
cat pnpm-workspace.yaml
```

Expected: glob includes `packages/connectors/*`. If not, add it (claude-code is already listed). Almost certainly already covered — confirm before edits.

- [ ] **Step 2: Create `package.json`**

Create `packages/connectors/shared/package.json`:

```json
{
  "name": "@megasaver/connectors-shared",
  "version": "0.0.0",
  "private": true,
  "description": "Shared helpers for Mega Saver connectors (block render, parse, filesystem).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "pnpm build && vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@megasaver/core": "workspace:*",
    "@megasaver/shared": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfigs / tsup / vitest configs**

Each is one-for-one copy from `packages/connectors/claude-code/`:

```bash
cp packages/connectors/claude-code/tsconfig.json packages/connectors/shared/tsconfig.json
cp packages/connectors/claude-code/tsconfig.test.json packages/connectors/shared/tsconfig.test.json
cp packages/connectors/claude-code/tsup.config.ts packages/connectors/shared/tsup.config.ts
cp packages/connectors/claude-code/vitest.config.ts packages/connectors/shared/vitest.config.ts
```

- [ ] **Step 4: Create stub `src/index.ts`**

Create `packages/connectors/shared/src/index.ts`:

```ts
export const PACKAGE_NAME = "@megasaver/connectors-shared";
```

- [ ] **Step 5: Install + verify**

```bash
pnpm install
pnpm --filter @megasaver/connectors-shared build
pnpm --filter @megasaver/connectors-shared typecheck
```

All green.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/shared pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore(connectors-shared): scaffold package"
```

---

## Task 3: connectors-shared — sentinels + agent-id-aware constants

**Files:**
- Create: `packages/connectors/shared/src/constants.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/constants.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/connectors/shared/test/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "../src/constants.js";

describe("connectors-shared constants", () => {
  it("uses HTML comment sentinels", () => {
    expect(MEGA_SAVER_BLOCK_START).toBe("<!-- MEGA SAVER:BEGIN -->");
    expect(MEGA_SAVER_BLOCK_END).toBe("<!-- MEGA SAVER:END -->");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './constants.js'`)

```bash
pnpm --filter @megasaver/connectors-shared test
```

- [ ] **Step 3: Create `constants.ts`**

```ts
export const MEGA_SAVER_BLOCK_START = "<!-- MEGA SAVER:BEGIN -->";
export const MEGA_SAVER_BLOCK_END = "<!-- MEGA SAVER:END -->";
```

- [ ] **Step 4: Wire `index.ts`**

Replace `packages/connectors/shared/src/index.ts` with:

```ts
export { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
```

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter @megasaver/connectors-shared test
pnpm --filter @megasaver/connectors-shared typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/shared/src/constants.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/constants.test.ts
git commit -m "feat(connectors-shared): add block sentinels"
```

---

## Task 4: connectors-shared — `ConnectorError` class + code schema

**Files:**
- Create: `packages/connectors/shared/src/errors.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/errors.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/connectors/shared/test/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ConnectorError,
  connectorErrorCodeSchema,
} from "../src/errors.js";

describe("ConnectorError", () => {
  it("enumerates the v0.1 code union", () => {
    expect(connectorErrorCodeSchema.options).toEqual([
      "context_invalid",
      "block_conflict",
      "file_read_failed",
      "file_write_failed",
      "target_path_invalid",
    ]);
  });

  it("captures code and filePath", () => {
    const err = new ConnectorError("block_conflict", "msg", { filePath: "/tmp/AGENTS.md" });
    expect(err.code).toBe("block_conflict");
    expect(err.filePath).toBe("/tmp/AGENTS.md");
    expect(err.name).toBe("ConnectorError");
  });

  it("defaults filePath to null", () => {
    const err = new ConnectorError("context_invalid", "msg");
    expect(err.filePath).toBeNull();
  });

  it("rejects unknown codes via schema", () => {
    expect(() => new ConnectorError("nope" as never, "msg")).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @megasaver/connectors-shared test
```

- [ ] **Step 3: Create `errors.ts`**

```ts
import { z } from "zod";

export const connectorErrorCodeSchema = z.enum([
  "context_invalid",
  "block_conflict",
  "file_read_failed",
  "file_write_failed",
  "target_path_invalid",
]);
export type ConnectorErrorCode = z.infer<typeof connectorErrorCodeSchema>;

interface ConnectorErrorOptions {
  cause?: unknown;
  filePath?: string | null;
}

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly filePath: string | null;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    options: ConnectorErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ConnectorError";
    this.code = connectorErrorCodeSchema.parse(code);
    this.filePath = options.filePath ?? null;
  }
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Append to `packages/connectors/shared/src/index.ts`:

```ts
export {
  ConnectorError,
  type ConnectorErrorCode,
  connectorErrorCodeSchema,
} from "./errors.js";
```

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter @megasaver/connectors-shared test
pnpm --filter @megasaver/connectors-shared typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/shared/src/errors.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/errors.test.ts
git commit -m "feat(connectors-shared): add ConnectorError"
```

---

## Task 5: connectors-shared — `ConnectorContextSchema`

**Files:**
- Create: `packages/connectors/shared/src/context.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Create: `packages/connectors/shared/test/fixtures.ts`
- Test: `packages/connectors/shared/test/context.test.ts`

- [ ] **Step 1: Create test fixtures**

Create `packages/connectors/shared/test/fixtures.ts` (copy/adapt from `packages/connectors/claude-code/test/fixtures.ts`, but parametrise by `agentId`):

```ts
import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/core";
import type { AgentId } from "@megasaver/shared";

export const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
export const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
export const MEMORY_ID = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const NOW = "2026-05-07T12:00:00.000Z";

export function buildContext(overrides?: {
  agentId?: AgentId;
  projectName?: string;
  withSession?: boolean;
  memoryEntries?: Array<{
    id: string;
    scope: "project" | "session";
    content: string;
  }>;
}) {
  const agentId: AgentId = overrides?.agentId ?? "claude-code";
  const withSession = overrides?.withSession ?? false;
  return {
    agentId,
    project: {
      id: PROJECT_ID,
      name: overrides?.projectName ?? "demo",
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    },
    session: withSession
      ? {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId,
          riskLevel: "MEDIUM",
          title: "smoke session",
          startedAt: NOW,
          endedAt: null,
        }
      : null,
    memoryEntries: (overrides?.memoryEntries ?? []).map((entry) => ({
      id: entry.id as never,
      projectId: PROJECT_ID,
      sessionId: entry.scope === "session" ? SESSION_ID : null,
      scope: entry.scope,
      content: entry.content,
      createdAt: NOW,
    })),
  };
}
```

- [ ] **Step 2: Write failing tests**

Create `packages/connectors/shared/test/context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConnectorContextSchema } from "../src/context.js";
import { buildContext, MEMORY_ID } from "./fixtures.js";

describe("ConnectorContextSchema", () => {
  it("accepts a minimal valid context", () => {
    expect(() => ConnectorContextSchema.parse(buildContext())).not.toThrow();
  });

  it("rejects sentinel substrings in project name", () => {
    expect(() =>
      ConnectorContextSchema.parse(
        buildContext({ projectName: "evil <!-- MEGA SAVER:BEGIN --> project" }),
      ),
    ).toThrow();
  });

  it("rejects mismatched session.agentId vs context.agentId", () => {
    const ctx = buildContext({ withSession: true });
    ctx.session!.agentId = "codex";
    expect(() => ConnectorContextSchema.parse(ctx)).toThrow();
  });

  it("rejects more than 20 memory entries", () => {
    const memoryEntries = Array.from({ length: 21 }, (_, i) => ({
      id: MEMORY_ID,
      scope: "project" as const,
      content: `m${i}`,
    }));
    expect(() => ConnectorContextSchema.parse(buildContext({ memoryEntries }))).toThrow();
  });

  it("rejects session-scoped memory without session", () => {
    expect(() =>
      ConnectorContextSchema.parse(
        buildContext({
          memoryEntries: [{ id: MEMORY_ID, scope: "session", content: "x" }],
        }),
      ),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Create `context.ts`**

```ts
import { memoryEntrySchema, projectSchema, sessionSchema } from "@megasaver/core";
import { agentIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";

const sentinels = [MEGA_SAVER_BLOCK_START, MEGA_SAVER_BLOCK_END] as const;
const containsSentinel = (value: string): boolean =>
  sentinels.some((sentinel) => value.includes(sentinel));

export const ConnectorContextSchema = z
  .object({
    agentId: agentIdSchema,
    project: projectSchema,
    session: sessionSchema.nullable(),
    memoryEntries: z.array(memoryEntrySchema).max(20),
  })
  .strict()
  .superRefine((context, ctx) => {
    if (containsSentinel(context.project.name)) {
      ctx.addIssue({
        code: "custom",
        message: "Project name cannot contain Mega Saver sentinels.",
        path: ["project", "name"],
      });
    }

    if (context.session !== null) {
      if (context.session.projectId !== context.project.id) {
        ctx.addIssue({
          code: "custom",
          message: "Session must belong to the project.",
          path: ["session", "projectId"],
        });
      }
      if (context.session.agentId !== context.agentId) {
        ctx.addIssue({
          code: "custom",
          message: "Session agent must match context agent.",
          path: ["session", "agentId"],
        });
      }
      if (context.session.title !== null && containsSentinel(context.session.title)) {
        ctx.addIssue({
          code: "custom",
          message: "Session title cannot contain Mega Saver sentinels.",
          path: ["session", "title"],
        });
      }
    }

    context.memoryEntries.forEach((entry, index) => {
      if (entry.projectId !== context.project.id) {
        ctx.addIssue({
          code: "custom",
          message: "Memory entry must belong to the project.",
          path: ["memoryEntries", index, "projectId"],
        });
      }
      if (containsSentinel(entry.content)) {
        ctx.addIssue({
          code: "custom",
          message: "Memory entry content cannot contain Mega Saver sentinels.",
          path: ["memoryEntries", index, "content"],
        });
      }
      if (entry.scope === "session") {
        if (context.session === null) {
          ctx.addIssue({
            code: "custom",
            message: "Session-scoped memory requires a matching session.",
            path: ["memoryEntries", index, "sessionId"],
          });
        } else if (entry.sessionId !== context.session.id) {
          ctx.addIssue({
            code: "custom",
            message: "Session-scoped memory must belong to the session.",
            path: ["memoryEntries", index, "sessionId"],
          });
        }
      }
    });
  });

export type ConnectorContext = z.infer<typeof ConnectorContextSchema>;

export function assertConnectorContext(input: unknown): ConnectorContext {
  const parsed = ConnectorContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConnectorError("context_invalid", "Connector context is invalid.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
```

- [ ] **Step 5: Re-export from index**

Append to `packages/connectors/shared/src/index.ts`:

```ts
export {
  type ConnectorContext,
  ConnectorContextSchema,
  assertConnectorContext,
} from "./context.js";
```

- [ ] **Step 6: Run, expect PASS**

```bash
pnpm --filter @megasaver/connectors-shared test
pnpm --filter @megasaver/connectors-shared typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/shared/src/context.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/fixtures.ts packages/connectors/shared/test/context.test.ts
git commit -m "feat(connectors-shared): add ConnectorContext schema"
```

---

## Task 6: connectors-shared — `renderBlock`

**Files:**
- Create: `packages/connectors/shared/src/render.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/render.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/connectors/shared/test/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderBlock } from "../src/render.js";
import { buildContext, MEMORY_ID } from "./fixtures.js";

describe("renderBlock", () => {
  it("renders the canonical block with no session and no memory", () => {
    const block = renderBlock(buildContext());
    expect(block).toMatchInlineSnapshot(`
      "<!-- MEGA SAVER:BEGIN -->
      # Mega Saver Context

      Agent: claude-code
      Project: demo (11111111-1111-4111-8111-111111111111)
      Session: none
      Risk: none

      ## Memory

      - none
      <!-- MEGA SAVER:END -->
      "
    `);
  });

  it("renders agentId from context", () => {
    const block = renderBlock(buildContext({ agentId: "codex" }));
    expect(block).toContain("Agent: codex");
  });

  it("renders session title and risk", () => {
    const block = renderBlock(buildContext({ withSession: true }));
    expect(block).toContain("Session: smoke session");
    expect(block).toContain("Risk: MEDIUM");
  });

  it("renders memory entries", () => {
    const block = renderBlock(
      buildContext({
        memoryEntries: [
          { id: MEMORY_ID, scope: "project", content: "first" },
        ],
      }),
    );
    expect(block).toContain(`- [project:${MEMORY_ID}] first`);
  });

  it("renders multi-line memory entries with continuation indent", () => {
    const block = renderBlock(
      buildContext({
        memoryEntries: [
          { id: MEMORY_ID, scope: "project", content: "line1\nline2" },
        ],
      }),
    );
    expect(block).toContain(`- [project:${MEMORY_ID}] line1\n  line2`);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Create `render.ts`** (port verbatim from claude-code, parametrise the agent line)

```ts
import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
import { type ConnectorContext, assertConnectorContext } from "./context.js";

export function renderBlock(input: ConnectorContext): string {
  const context = assertConnectorContext(input);
  const sessionLabel = context.session?.title ?? context.session?.id ?? "none";
  const riskLevel = context.session?.riskLevel ?? "none";

  return [
    MEGA_SAVER_BLOCK_START,
    "# Mega Saver Context",
    "",
    `Agent: ${context.agentId}`,
    `Project: ${context.project.name} (${context.project.id})`,
    `Session: ${sessionLabel}`,
    `Risk: ${riskLevel}`,
    "",
    "## Memory",
    "",
    ...renderMemoryEntries(context),
    MEGA_SAVER_BLOCK_END,
    "",
  ].join("\n");
}

function renderMemoryEntries(context: ConnectorContext): string[] {
  if (context.memoryEntries.length === 0) {
    return ["- none"];
  }
  return context.memoryEntries.map((entry) => {
    const target = `${entry.scope}:${entry.id}`;
    const [firstLine = "", ...continuationLines] = entry.content.split("\n");
    const renderedContinuation = continuationLines.map((line) => `  ${line}`).join("\n");
    if (renderedContinuation.length === 0) {
      return `- [${target}] ${firstLine}`;
    }
    return `- [${target}] ${firstLine}\n${renderedContinuation}`;
  });
}
```

- [ ] **Step 4: Re-export from index**

Append:

```ts
export { renderBlock } from "./render.js";
```

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/shared/src/render.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/render.test.ts
git commit -m "feat(connectors-shared): add renderBlock"
```

---

## Task 7: connectors-shared — `parseBlock`

**Files:**
- Create: `packages/connectors/shared/src/parse.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/parse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/connectors/shared/test/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConnectorError } from "../src/errors.js";
import { parseBlock } from "../src/parse.js";

describe("parseBlock", () => {
  it("returns no block for content without sentinels", () => {
    expect(parseBlock("hello\nworld\n")).toEqual({
      before: "hello\nworld\n",
      block: null,
      after: "",
    });
  });

  it("extracts a single block with surrounding content", () => {
    const content = "intro\n<!-- MEGA SAVER:BEGIN -->\nbody\n<!-- MEGA SAVER:END -->\nafter\n";
    const parsed = parseBlock(content);
    expect(parsed.before).toBe("intro\n");
    expect(parsed.block).toContain("MEGA SAVER:BEGIN");
    expect(parsed.block).toContain("MEGA SAVER:END");
    expect(parsed.after).toBe("after\n");
  });

  it("rejects two begin sentinels", () => {
    const content =
      "<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\n";
    expect(() => parseBlock(content)).toThrow(ConnectorError);
  });

  it("rejects mismatched sentinel counts", () => {
    expect(() => parseBlock("<!-- MEGA SAVER:BEGIN -->\n")).toThrow(ConnectorError);
    expect(() => parseBlock("<!-- MEGA SAVER:END -->\n")).toThrow(ConnectorError);
  });

  it("rejects end before begin", () => {
    expect(() =>
      parseBlock("<!-- MEGA SAVER:END -->\n<!-- MEGA SAVER:BEGIN -->\n"),
    ).toThrow(ConnectorError);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Create `parse.ts`** (port verbatim from claude-code's helpers, but the public function name is `parseBlock`)

```ts
import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";

export interface ParsedBlock {
  before: string;
  block: string | null;
  after: string;
}

interface IndexedLine {
  text: string;
  raw: string;
}

export function parseBlock(content: string): ParsedBlock {
  const lines = splitIndexedLines(content);
  const starts = sentinelIndexes(lines, MEGA_SAVER_BLOCK_START);
  const ends = sentinelIndexes(lines, MEGA_SAVER_BLOCK_END);

  if (starts.length === 0 && ends.length === 0) {
    return { before: content, block: null, after: "" };
  }
  if (starts.length !== 1 || ends.length !== 1) {
    throwBlockConflict();
  }

  const startIndex = starts[0] as number;
  const endIndex = ends[0] as number;
  if (endIndex < startIndex) {
    throwBlockConflict();
  }

  return {
    before: lines.slice(0, startIndex).map((l) => l.raw).join(""),
    block: lines.slice(startIndex, endIndex + 1).map((l) => l.raw).join(""),
    after: lines.slice(endIndex + 1).map((l) => l.raw).join(""),
  };
}

export function splitIndexedLines(content: string): IndexedLine[] {
  if (content.length === 0) return [];
  return (
    content
      .match(/[^\n]*(?:\n|$)/g)
      ?.filter((line) => line !== "")
      .map((raw) => ({
        raw,
        text: raw.endsWith("\n") ? raw.slice(0, -1).replace(/\r$/, "") : raw,
      })) ?? []
  );
}

export function sentinelIndexes(lines: IndexedLine[], sentinel: string): number[] {
  return lines.flatMap((line, index) => (line.text === sentinel ? [index] : []));
}

function throwBlockConflict(): never {
  throw new ConnectorError(
    "block_conflict",
    "File contains conflicting Mega Saver managed block sentinels.",
  );
}

export type { IndexedLine };
```

`splitIndexedLines` and `sentinelIndexes` are exported because the upsert/remove helpers in Task 8/9 need them.

- [ ] **Step 4: Re-export from index**

```ts
export { parseBlock, type ParsedBlock } from "./parse.js";
```

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/shared/src/parse.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/parse.test.ts
git commit -m "feat(connectors-shared): add parseBlock"
```

---

## Task 8: connectors-shared — `upsertBlock` + `removeBlock`

**Files:**
- Create: `packages/connectors/shared/src/upsert.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/upsert.test.ts`
- Test: `packages/connectors/shared/test/remove.test.ts`

- [ ] **Step 1: Write failing upsert tests**

Create `packages/connectors/shared/test/upsert.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upsertBlock } from "../src/upsert.js";
import { buildContext } from "./fixtures.js";

describe("upsertBlock", () => {
  it("inserts a block when no block is present", () => {
    const result = upsertBlock({ existingContent: "", context: buildContext() });
    expect(result).toContain("<!-- MEGA SAVER:BEGIN -->");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("preserves user content above the inserted block", () => {
    const result = upsertBlock({
      existingContent: "# My README\n\nintro\n",
      context: buildContext(),
    });
    expect(result.startsWith("# My README\n\nintro\n\n")).toBe(true);
    expect(result).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("replaces an existing block in place", () => {
    const first = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({ projectName: "first" }),
    });
    const replaced = upsertBlock({
      existingContent: first,
      context: buildContext({ projectName: "second" }),
    });
    expect(replaced).toContain("Project: second");
    expect(replaced).not.toContain("Project: first");
  });
});
```

- [ ] **Step 2: Write failing remove tests**

Create `packages/connectors/shared/test/remove.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { removeBlock } from "../src/upsert.js";
import { upsertBlock } from "../src/upsert.js";
import { buildContext } from "./fixtures.js";

describe("removeBlock", () => {
  it("removes the block and preserves surrounding content", () => {
    const inserted = upsertBlock({
      existingContent: "intro\n",
      context: buildContext(),
    });
    const removed = removeBlock(inserted);
    expect(removed).toBe("intro\n");
  });

  it("is a no-op when no block exists", () => {
    expect(removeBlock("# README\n")).toBe("# README\n");
  });

  it("returns empty string when input is empty", () => {
    expect(removeBlock("")).toBe("");
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Create `upsert.ts`** (port from claude-code, generic by call to `renderBlock` instead of `renderClaudeCodeContext`)

```ts
import { type ConnectorContext } from "./context.js";
import { type IndexedLine, parseBlock, splitIndexedLines } from "./parse.js";
import { renderBlock } from "./render.js";

interface UpsertBlockInput {
  existingContent: string;
  context: ConnectorContext;
}

export function upsertBlock(input: UpsertBlockInput): string {
  const block = renderBlock(input.context);
  const parsed = parseBlock(input.existingContent);

  if (parsed.block !== null) {
    return joinWithManagedBlock(parsed.before, parsed.block, parsed.after, block);
  }

  const humanContent = trimTrailingBoundaryForJoin(parsed.before);
  if (humanContent.length === 0) {
    return block;
  }
  return `${humanContent}\n\n${block}`;
}

export function removeBlock(content: string): string {
  const parsed = parseBlock(content);
  if (parsed.block === null) {
    return content.length === 0 ? "" : ensureTrailingNewline(content);
  }
  const remaining = joinHumanContent(parsed.before, parsed.after);
  if (remaining.trim().length === 0) {
    return "";
  }
  return ensureTrailingNewline(remaining);
}

function joinWithManagedBlock(
  before: string,
  _existingBlock: string,
  after: string,
  newBlock: string,
): string {
  const normalizedBefore = trimTrailingBoundaryForJoin(before);
  const normalizedAfter = trimLeadingBoundaryLines(after);
  const prefix = normalizedBefore.length === 0 ? "" : `${normalizedBefore}\n\n`;
  const suffix = normalizedAfter.length === 0 ? "" : `\n${normalizedAfter}`;
  return ensureTrailingNewline(`${prefix}${newBlock}${suffix}`);
}

function joinHumanContent(before: string, after: string): string {
  const normalizedBefore = trimTrailingBoundaryForJoin(before);
  const normalizedAfter = trimLeadingBoundaryLines(after);
  if (normalizedBefore.length === 0) return normalizedAfter;
  if (normalizedAfter.length === 0) return normalizedBefore;
  return `${normalizedBefore}\n\n${normalizedAfter}`;
}

function trimTrailingBoundaryLines(content: string): string {
  const lines = splitIndexedLines(content);
  let end = lines.length;
  while (end > 0 && normalizedLineIsBlank(lines[end - 1] as IndexedLine)) end -= 1;
  return lines.slice(0, end).map((l) => l.raw).join("");
}

function trimTrailingBoundaryForJoin(content: string): string {
  return trimTrailingBoundaryLines(content).replace(/\r?\n$/u, "");
}

function trimLeadingBoundaryLines(content: string): string {
  const lines = splitIndexedLines(content);
  let start = 0;
  while (start < lines.length && normalizedLineIsBlank(lines[start] as IndexedLine)) start += 1;
  return lines.slice(start).map((l) => l.raw).join("");
}

function normalizedLineIsBlank(line: IndexedLine): boolean {
  return line.text.trim().length === 0;
}

function ensureTrailingNewline(content: string): string {
  const normalized = trimTrailingBoundaryLines(content);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}
```

- [ ] **Step 5: Re-export from index**

```ts
export { removeBlock, upsertBlock } from "./upsert.js";
```

- [ ] **Step 6: Run, expect PASS**

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/shared/src/upsert.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/upsert.test.ts packages/connectors/shared/test/remove.test.ts
git commit -m "feat(connectors-shared): add upsertBlock and removeBlock"
```

---

## Task 9: connectors-shared — filesystem helpers

**Files:**
- Create: `packages/connectors/shared/src/filesystem.ts`
- Modify: `packages/connectors/shared/src/index.ts`
- Test: `packages/connectors/shared/test/filesystem.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/connectors/shared/test/filesystem.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectorError } from "../src/errors.js";
import {
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "../src/filesystem.js";
import { buildContext } from "./fixtures.js";

describe("filesystem helpers", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-shared-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("readTargetFile returns null when file is missing", async () => {
    expect(await readTargetFile(join(root, "missing.md"))).toBeNull();
  });

  it("writeTargetFile then readTargetFile round-trip", async () => {
    const path = join(root, "AGENTS.md");
    await writeTargetFile({ absPath: path, content: "hello\n" });
    expect(await readTargetFile(path)).toBe("hello\n");
  });

  it("syncTargetBlock creates the file with the rendered block", async () => {
    const path = join(root, "AGENTS.md");
    await syncTargetBlock({ absPath: path, context: buildContext() });
    const written = await readFile(path, "utf8");
    expect(written).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("syncTargetBlock preserves user content above the block", async () => {
    const path = join(root, "AGENTS.md");
    await writeTargetFile({ absPath: path, content: "# user\n\n" });
    await syncTargetBlock({ absPath: path, context: buildContext() });
    const written = await readFile(path, "utf8");
    expect(written.startsWith("# user\n\n\n<!--")).toBe(true);
  });

  it("writeTargetFile surfaces ENOTDIR/EACCES as file_write_failed", async () => {
    const bogus = join(root, "does", "not", "exist", "AGENTS.md");
    await expect(
      writeTargetFile({ absPath: bogus, content: "x" }),
    ).rejects.toBeInstanceOf(ConnectorError);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Create `filesystem.ts`**

```ts
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type ConnectorContext } from "./context.js";
import { ConnectorError } from "./errors.js";
import { upsertBlock } from "./upsert.js";

interface WriteTargetFileInput {
  absPath: string;
  content: string;
}

interface SyncTargetBlockInput {
  absPath: string;
  context: ConnectorContext;
}

export async function readTargetFile(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return null;
    throw new ConnectorError("file_read_failed", "Failed to read target file.", {
      cause: error,
      filePath: absPath,
    });
  }
}

export async function writeTargetFile(input: WriteTargetFileInput): Promise<void> {
  const tempPath = join(dirname(input.absPath), `.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, input.content, "utf8");
    await rename(tempPath, input.absPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new ConnectorError("file_write_failed", "Failed to write target file.", {
      cause: error,
      filePath: input.absPath,
    });
  }
}

export async function syncTargetBlock(input: SyncTargetBlockInput): Promise<string> {
  const existing = (await readTargetFile(input.absPath)) ?? "";
  const content = upsertBlock({ existingContent: existing, context: input.context });
  await writeTargetFile({ absPath: input.absPath, content });
  return content;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
```

- [ ] **Step 4: Re-export from index**

```ts
export { readTargetFile, syncTargetBlock, writeTargetFile } from "./filesystem.js";
```

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/shared/src/filesystem.ts packages/connectors/shared/src/index.ts packages/connectors/shared/test/filesystem.test.ts
git commit -m "feat(connectors-shared): add filesystem helpers"
```

---

## Task 10: connectors-shared — public-export smoke

**Files:**
- Test: `packages/connectors/shared/test/public-export.test.ts`

- [ ] **Step 1: Write smoke test**

Create `packages/connectors/shared/test/public-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as pkg from "../dist/index.js";

describe("@megasaver/connectors-shared public exports", () => {
  it("exposes the v0.1 surface", () => {
    expect(typeof pkg.MEGA_SAVER_BLOCK_START).toBe("string");
    expect(typeof pkg.MEGA_SAVER_BLOCK_END).toBe("string");
    expect(typeof pkg.renderBlock).toBe("function");
    expect(typeof pkg.parseBlock).toBe("function");
    expect(typeof pkg.upsertBlock).toBe("function");
    expect(typeof pkg.removeBlock).toBe("function");
    expect(typeof pkg.readTargetFile).toBe("function");
    expect(typeof pkg.writeTargetFile).toBe("function");
    expect(typeof pkg.syncTargetBlock).toBe("function");
    expect(typeof pkg.assertConnectorContext).toBe("function");
    expect(typeof pkg.ConnectorError).toBe("function");
    expect(pkg.connectorErrorCodeSchema).toBeDefined();
    expect(pkg.ConnectorContextSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect PASS** (after `pnpm build`)

```bash
pnpm --filter @megasaver/connectors-shared test
```

`test` already chains `pnpm build` before vitest, so dist will be fresh.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/shared/test/public-export.test.ts
git commit -m "test(connectors-shared): add public export smoke"
```

---

## Task 11: Capture pre-refactor claude-code render baseline

This freezes the byte-string the refactor must reproduce.

**Files:**
- Create: `packages/connectors/claude-code/test/regression-fixture.ts`

- [ ] **Step 1: Generate baseline**

Run a one-shot Node script from the worktree root:

```bash
node --input-type=module -e '
import { renderClaudeCodeContext } from "./packages/connectors/claude-code/dist/index.js";
import { projectIdSchema, sessionIdSchema, memoryEntryIdSchema } from "./packages/core/dist/index.js";

const projectId = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const sessionId = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const memoryId = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");

const ctx = {
  project: { id: projectId, name: "demo", rootPath: "/tmp/demo", createdAt: "2026-05-07T12:00:00.000Z", updatedAt: "2026-05-07T12:00:00.000Z" },
  session: { id: sessionId, projectId, agentId: "claude-code", riskLevel: "MEDIUM", title: "smoke session", startedAt: "2026-05-07T12:00:00.000Z", endedAt: null },
  memoryEntries: [{ id: memoryId, projectId, sessionId, scope: "session", content: "first", createdAt: "2026-05-07T12:00:00.000Z" }],
};
process.stdout.write(JSON.stringify(renderClaudeCodeContext(ctx)));
' > .tmp-claude-baseline.json
```

If `dist/` is stale, run `pnpm --filter @megasaver/connector-claude-code build` and `pnpm --filter @megasaver/core build` first.

- [ ] **Step 2: Inspect output**

```bash
cat .tmp-claude-baseline.json
```

Confirm it is a single-quoted JSON string containing `<!-- MEGA SAVER:BEGIN -->` and the canonical block ending in `\n`.

- [ ] **Step 3: Embed baseline as a TS fixture**

Create `packages/connectors/claude-code/test/regression-fixture.ts`:

```ts
// Frozen pre-refactor render output. Updating this fixture in the same
// commit as a refactor of renderClaudeCodeContext defeats the purpose.
export const PRE_REFACTOR_BLOCK = JSON.parse(
  // paste the JSON-encoded string from Step 2 here
  '"<!-- MEGA SAVER:BEGIN -->\\n# Mega Saver Context\\n\\nAgent: claude-code\\nProject: demo (11111111-1111-4111-8111-111111111111)\\nSession: smoke session\\nRisk: MEDIUM\\n\\n## Memory\\n\\n- [session:33333333-3333-4333-8333-333333333333] first\\n<!-- MEGA SAVER:END -->\\n"',
);
```

If your baseline JSON differs from the literal above (e.g. extra whitespace), copy the actual `.tmp-claude-baseline.json` content as the JSON-encoded string.

- [ ] **Step 4: Clean up baseline file**

```bash
rm .tmp-claude-baseline.json
```

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/claude-code/test/regression-fixture.ts
git commit -m "test(connector-claude-code): capture pre-refactor render baseline"
```

---

## Task 12: claude-code refactor — add `connectors-shared` dep

**Files:**
- Modify: `packages/connectors/claude-code/package.json`

- [ ] **Step 1: Add dependency**

Edit `packages/connectors/claude-code/package.json` `dependencies` to include:

```json
"@megasaver/connectors-shared": "workspace:*"
```

So the block becomes:

```json
"dependencies": {
  "@megasaver/connectors-shared": "workspace:*",
  "@megasaver/core": "workspace:*",
  "@megasaver/shared": "workspace:*",
  "zod": "^3.24.1"
}
```

- [ ] **Step 2: Install + sanity check**

```bash
pnpm install
pnpm --filter @megasaver/connector-claude-code typecheck
pnpm --filter @megasaver/connector-claude-code test
```

All 44 existing tests still green (no source changes yet).

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/claude-code/package.json pnpm-lock.yaml
git commit -m "chore(connector-claude-code): depend on connectors-shared"
```

---

## Task 13: claude-code refactor — constants re-export

**Files:**
- Modify: `packages/connectors/claude-code/src/constants.ts`

- [ ] **Step 1: Replace local sentinels with re-export**

Edit `packages/connectors/claude-code/src/constants.ts`:

```ts
import type { AgentId } from "@megasaver/shared";
export {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "@megasaver/connectors-shared";

export const CLAUDE_CODE_AGENT_ID = "claude-code" satisfies AgentId;
export const CLAUDE_MD_FILE = "CLAUDE.md";
```

- [ ] **Step 2: Run claude-code suite, expect PASS**

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/connector-claude-code typecheck
```

44 tests green.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/claude-code/src/constants.ts
git commit -m "refactor(connector-claude-code): re-export sentinels from shared"
```

---

## Task 14: claude-code refactor — context schema delegation

**Files:**
- Modify: `packages/connectors/claude-code/src/context.ts`

- [ ] **Step 1: Replace context.ts**

Edit `packages/connectors/claude-code/src/context.ts`:

```ts
import { ConnectorContextSchema } from "@megasaver/connectors-shared";
import { z } from "zod";
import { CLAUDE_CODE_AGENT_ID } from "./constants.js";
import { ClaudeCodeConnectorError } from "./errors.js";

export const ClaudeCodeContextSchema = ConnectorContextSchema.superRefine((context, ctx) => {
  if (context.agentId !== CLAUDE_CODE_AGENT_ID) {
    ctx.addIssue({
      code: "custom",
      message: "Context agent must be Claude Code.",
      path: ["agentId"],
    });
  }
});

export type ClaudeCodeContext = z.infer<typeof ClaudeCodeContextSchema>;

export function assertClaudeCodeContext(input: unknown): ClaudeCodeContext {
  const parsed = ClaudeCodeContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new ClaudeCodeConnectorError(
      "claude_md_context_invalid",
      "Claude Code context is invalid.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
```

Note: Existing claude-code tests may build context fixtures without an `agentId` field at the top level (the old schema didn't have it). Those fixtures need updating — see Step 2.

- [ ] **Step 2: Update claude-code test fixtures**

Edit `packages/connectors/claude-code/test/fixtures.ts` so every constructed context object includes `agentId: "claude-code"` at the top level. Search the file:

```bash
grep -n "agentId" packages/connectors/claude-code/test/fixtures.ts
```

Add `agentId: "claude-code"` (typed via `agentIdSchema.parse`) to the top-level object. Also update any inline contexts in tests that bypass the fixture builder.

- [ ] **Step 3: Run, expect PASS**

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/connector-claude-code typecheck
```

If a test fails because of a missing `agentId`, fix the fixture/test and re-run.

- [ ] **Step 4: Commit**

```bash
git add packages/connectors/claude-code/src/context.ts packages/connectors/claude-code/test/fixtures.ts packages/connectors/claude-code/test/context.test.ts packages/connectors/claude-code/test/markdown.test.ts
git commit -m "refactor(connector-claude-code): delegate context schema to shared"
```

---

## Task 15: claude-code refactor — error wrapping with code map

**Files:**
- Modify: `packages/connectors/claude-code/src/errors.ts`

- [ ] **Step 1: Replace errors.ts**

Edit `packages/connectors/claude-code/src/errors.ts`:

```ts
import {
  ConnectorError,
  type ConnectorErrorCode,
} from "@megasaver/connectors-shared";
import { z } from "zod";

export const claudeCodeConnectorErrorCodeSchema = z.enum([
  "claude_md_context_invalid",
  "claude_md_block_conflict",
  "claude_md_read_failed",
  "claude_md_write_failed",
  "project_root_invalid",
]);
export type ClaudeCodeConnectorErrorCode = z.infer<typeof claudeCodeConnectorErrorCodeSchema>;

interface ClaudeCodeConnectorErrorOptions {
  cause?: unknown;
  filePath?: string | null;
}

export class ClaudeCodeConnectorError extends Error {
  readonly code: ClaudeCodeConnectorErrorCode;
  readonly filePath: string | null;

  constructor(
    code: ClaudeCodeConnectorErrorCode,
    message: string,
    options: ClaudeCodeConnectorErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ClaudeCodeConnectorError";
    this.code = claudeCodeConnectorErrorCodeSchema.parse(code);
    this.filePath = options.filePath ?? null;
  }
}

export function mapSharedErrorCode(code: ConnectorErrorCode): ClaudeCodeConnectorErrorCode {
  switch (code) {
    case "context_invalid":
      return "claude_md_context_invalid";
    case "block_conflict":
      return "claude_md_block_conflict";
    case "file_read_failed":
      return "claude_md_read_failed";
    case "file_write_failed":
      return "claude_md_write_failed";
    case "target_path_invalid":
      return "project_root_invalid";
  }
}

export function wrapSharedConnectorError(
  error: unknown,
  filePath: string | null,
): never {
  if (error instanceof ConnectorError) {
    throw new ClaudeCodeConnectorError(
      mapSharedErrorCode(error.code),
      error.message,
      { cause: error, filePath: filePath ?? error.filePath },
    );
  }
  throw error;
}
```

- [ ] **Step 2: Run claude-code error tests, expect PASS**

```bash
pnpm --filter @megasaver/connector-claude-code test -- errors
pnpm --filter @megasaver/connector-claude-code typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/claude-code/src/errors.ts
git commit -m "refactor(connector-claude-code): wrap shared error codes"
```

---

## Task 16: claude-code refactor — markdown helpers thin wrappers

**Files:**
- Modify: `packages/connectors/claude-code/src/markdown.ts`

- [ ] **Step 1: Replace markdown.ts**

Edit `packages/connectors/claude-code/src/markdown.ts`:

```ts
import {
  parseBlock,
  removeBlock,
  renderBlock,
  upsertBlock,
} from "@megasaver/connectors-shared";
import { type ClaudeCodeContext, assertClaudeCodeContext } from "./context.js";
import { wrapSharedConnectorError } from "./errors.js";

export interface ClaudeMdDocument {
  hasManagedBlock: boolean;
  contentBeforeBlock: string;
  managedBlock: string | null;
  contentAfterBlock: string;
}

interface UpsertMegaSaverBlockInput {
  existingContent: string;
  context: ClaudeCodeContext;
}

export function renderClaudeCodeContext(input: ClaudeCodeContext): string {
  const context = assertClaudeCodeContext(input);
  return renderBlock(context);
}

export function parseClaudeMd(content: string): ClaudeMdDocument {
  try {
    const parsed = parseBlock(content);
    return {
      hasManagedBlock: parsed.block !== null,
      contentBeforeBlock: parsed.before,
      managedBlock: parsed.block,
      contentAfterBlock: parsed.after,
    };
  } catch (error) {
    wrapSharedConnectorError(error, null);
    return undefined as never;
  }
}

export function upsertMegaSaverBlock(input: UpsertMegaSaverBlockInput): string {
  const context = assertClaudeCodeContext(input.context);
  try {
    return upsertBlock({ existingContent: input.existingContent, context });
  } catch (error) {
    wrapSharedConnectorError(error, null);
    return undefined as never;
  }
}

export function removeMegaSaverBlock(content: string): string {
  try {
    return removeBlock(content);
  } catch (error) {
    wrapSharedConnectorError(error, null);
    return undefined as never;
  }
}
```

- [ ] **Step 2: Run, expect PASS**

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/connector-claude-code typecheck
```

All 44 tests still green.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/claude-code/src/markdown.ts
git commit -m "refactor(connector-claude-code): proxy markdown helpers to shared"
```

---

## Task 17: claude-code refactor — filesystem helpers thin wrappers

**Files:**
- Modify: `packages/connectors/claude-code/src/filesystem.ts`

- [ ] **Step 1: Replace filesystem.ts**

Edit `packages/connectors/claude-code/src/filesystem.ts`:

```ts
import {
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { CLAUDE_MD_FILE } from "./constants.js";
import type { ClaudeCodeContext } from "./context.js";
import { ClaudeCodeConnectorError, wrapSharedConnectorError } from "./errors.js";
import { upsertMegaSaverBlock } from "./markdown.js";

interface WriteClaudeMdInput {
  projectRoot: string;
  content: string;
}

interface SyncClaudeMdContextInput {
  projectRoot: string;
  context: ClaudeCodeContext;
}

export async function readClaudeMd(projectRoot: string): Promise<string | null> {
  const filePath = await claudeMdPath(projectRoot);
  try {
    return await readTargetFile(filePath);
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return null;
  }
}

export async function writeClaudeMd(input: WriteClaudeMdInput): Promise<void> {
  const filePath = await claudeMdPath(input.projectRoot);
  try {
    await writeTargetFile({ absPath: filePath, content: input.content });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
  }
}

export async function syncClaudeMdContext(input: SyncClaudeMdContextInput): Promise<string> {
  const filePath = await claudeMdPath(input.projectRoot);
  try {
    return await syncTargetBlock({ absPath: filePath, context: input.context });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return undefined as never;
  }
}

async function claudeMdPath(projectRoot: string): Promise<string> {
  await assertProjectRoot(projectRoot);
  return join(projectRoot, CLAUDE_MD_FILE);
}

async function assertProjectRoot(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) throwInvalidProjectRoot(projectRoot);
  try {
    const projectRootStat = await stat(projectRoot);
    if (!projectRootStat.isDirectory()) throwInvalidProjectRoot(projectRoot);
  } catch (error) {
    if (error instanceof ClaudeCodeConnectorError) throw error;
    throwInvalidProjectRoot(projectRoot, error);
  }
}

function throwInvalidProjectRoot(projectRoot: string, cause?: unknown): never {
  throw new ClaudeCodeConnectorError(
    "project_root_invalid",
    "Project root must be an absolute path to an existing directory.",
    { cause, filePath: projectRoot },
  );
}
```

Note: this preserves the `assertProjectRoot` semantics (caller-friendly absolute-dir check). Shared `syncTargetBlock` delegates the file write but not the project-root validation — that stays in claude-code as a wrapper-layer guarantee.

The unused `upsertMegaSaverBlock` import is left intentional only if the linter complains; otherwise drop it.

- [ ] **Step 2: Drop unused imports if biome flags them**

```bash
pnpm exec biome check packages/connectors/claude-code/src/filesystem.ts
```

If `useImportType` or `noUnusedImports` triggers, fix and re-run.

- [ ] **Step 3: Run, expect PASS**

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/connector-claude-code typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/connectors/claude-code/src/filesystem.ts
git commit -m "refactor(connector-claude-code): proxy filesystem to shared"
```

---

## Task 18: claude-code regression test — bit-identical render

**Files:**
- Test: `packages/connectors/claude-code/test/regression.test.ts`

- [ ] **Step 1: Write regression test**

Create `packages/connectors/claude-code/test/regression.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderClaudeCodeContext } from "../src/index.js";
import { PRE_REFACTOR_BLOCK } from "./regression-fixture.js";
import { agentIdSchema } from "@megasaver/shared";
import {
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/core";

describe("claude-code render — pre-refactor parity", () => {
  it("produces byte-identical output for the canonical context", () => {
    const projectId = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
    const sessionId = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
    const memoryId = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
    const agentId = agentIdSchema.parse("claude-code");
    const NOW = "2026-05-07T12:00:00.000Z";

    const ctx = {
      agentId,
      project: {
        id: projectId,
        name: "demo",
        rootPath: "/tmp/demo",
        createdAt: NOW,
        updatedAt: NOW,
      },
      session: {
        id: sessionId,
        projectId,
        agentId,
        riskLevel: "MEDIUM" as const,
        title: "smoke session",
        startedAt: NOW,
        endedAt: null,
      },
      memoryEntries: [
        {
          id: memoryId,
          projectId,
          sessionId,
          scope: "session" as const,
          content: "first",
          createdAt: NOW,
        },
      ],
    };

    expect(renderClaudeCodeContext(ctx)).toBe(PRE_REFACTOR_BLOCK);
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
pnpm --filter @megasaver/connector-claude-code test -- regression
```

If it FAILS, the refactor is wrong — debug before proceeding.

- [ ] **Step 3: Run full claude-code suite**

```bash
pnpm --filter @megasaver/connector-claude-code test
```

All 45 tests green (44 existing + 1 regression).

- [ ] **Step 4: Commit**

```bash
git add packages/connectors/claude-code/test/regression.test.ts
git commit -m "test(connector-claude-code): assert bit-identical render"
```

---

## Task 19: Scaffold `@megasaver/connector-generic-cli`

**Files:**
- Create: `packages/connectors/generic-cli/package.json`
- Create: `packages/connectors/generic-cli/tsconfig.json`
- Create: `packages/connectors/generic-cli/tsconfig.test.json`
- Create: `packages/connectors/generic-cli/tsup.config.ts`
- Create: `packages/connectors/generic-cli/vitest.config.ts`
- Create: `packages/connectors/generic-cli/src/index.ts`

- [ ] **Step 1: Copy claude-code package skeleton**

```bash
mkdir -p packages/connectors/generic-cli/src packages/connectors/generic-cli/test
cp packages/connectors/claude-code/tsconfig.json packages/connectors/generic-cli/tsconfig.json
cp packages/connectors/claude-code/tsconfig.test.json packages/connectors/generic-cli/tsconfig.test.json
cp packages/connectors/claude-code/tsup.config.ts packages/connectors/generic-cli/tsup.config.ts
cp packages/connectors/claude-code/vitest.config.ts packages/connectors/generic-cli/vitest.config.ts
```

- [ ] **Step 2: Create `package.json`**

`packages/connectors/generic-cli/package.json`:

```json
{
  "name": "@megasaver/connector-generic-cli",
  "version": "0.0.0",
  "private": true,
  "description": "Manifest-driven generic-CLI connector for Mega Saver.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "pnpm build && vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@megasaver/connectors-shared": "workspace:*",
    "@megasaver/core": "workspace:*",
    "@megasaver/shared": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 3: Stub `src/index.ts`**

```ts
export const PACKAGE_NAME = "@megasaver/connector-generic-cli";
```

- [ ] **Step 4: Install + build**

```bash
pnpm install
pnpm --filter @megasaver/connector-generic-cli build
pnpm --filter @megasaver/connector-generic-cli typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/generic-cli pnpm-lock.yaml
git commit -m "chore(connector-generic-cli): scaffold package"
```

---

## Task 20: generic-cli — `ConnectorTarget` + `codexTarget` + `findTarget`

**Files:**
- Create: `packages/connectors/generic-cli/src/targets.ts`
- Modify: `packages/connectors/generic-cli/src/index.ts`
- Test: `packages/connectors/generic-cli/test/targets.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/connectors/generic-cli/test/targets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { builtinTargets, codexTarget, findTarget } from "../src/targets.js";

describe("ConnectorTarget registry", () => {
  it("ships the codex target", () => {
    expect(codexTarget).toEqual({
      id: "codex",
      agentId: "codex",
      relativePath: "AGENTS.md",
    });
  });

  it("findTarget returns the codex target by id", () => {
    expect(findTarget("codex")).toBe(codexTarget);
  });

  it("findTarget returns null for unknown ids", () => {
    expect(findTarget("missing")).toBeNull();
  });

  it("builtinTargets is frozen and contains codex", () => {
    expect(Object.isFrozen(builtinTargets)).toBe(true);
    expect(builtinTargets).toContain(codexTarget);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Create `targets.ts`**

```ts
import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
}

export const codexTarget: ConnectorTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([codexTarget]);

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
```

- [ ] **Step 4: Re-export from index**

Replace `packages/connectors/generic-cli/src/index.ts`:

```ts
export {
  builtinTargets,
  codexTarget,
  type ConnectorTarget,
  findTarget,
} from "./targets.js";
```

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter @megasaver/connector-generic-cli test
pnpm --filter @megasaver/connector-generic-cli typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/generic-cli/src packages/connectors/generic-cli/test/targets.test.ts
git commit -m "feat(connector-generic-cli): add ConnectorTarget registry"
```

---

## Task 21: generic-cli — `GenericCliConnectorError`

**Files:**
- Create: `packages/connectors/generic-cli/src/errors.ts`
- Modify: `packages/connectors/generic-cli/src/index.ts`
- Test: `packages/connectors/generic-cli/test/errors.test.ts`

- [ ] **Step 1: Write failing test**

`packages/connectors/generic-cli/test/errors.test.ts`:

```ts
import { ConnectorError } from "@megasaver/connectors-shared";
import { describe, expect, it } from "vitest";
import {
  GenericCliConnectorError,
  genericCliConnectorErrorCodeSchema,
  mapSharedErrorCode,
} from "../src/errors.js";

describe("GenericCliConnectorError", () => {
  it("enumerates the v0.1 code union", () => {
    expect(genericCliConnectorErrorCodeSchema.options).toEqual([
      "target_unknown",
      "context_invalid",
      "block_conflict",
      "file_read_failed",
      "file_write_failed",
      "project_root_invalid",
    ]);
  });

  it("maps shared error codes 1:1", () => {
    expect(mapSharedErrorCode("context_invalid")).toBe("context_invalid");
    expect(mapSharedErrorCode("block_conflict")).toBe("block_conflict");
    expect(mapSharedErrorCode("file_read_failed")).toBe("file_read_failed");
    expect(mapSharedErrorCode("file_write_failed")).toBe("file_write_failed");
    expect(mapSharedErrorCode("target_path_invalid")).toBe("project_root_invalid");
  });

  it("captures code and filePath", () => {
    const err = new GenericCliConnectorError("target_unknown", "msg");
    expect(err.code).toBe("target_unknown");
    expect(err.filePath).toBeNull();
    expect(err.name).toBe("GenericCliConnectorError");
  });

  it("ConnectorError instance is mappable", () => {
    const cause = new ConnectorError("block_conflict", "boom");
    expect(mapSharedErrorCode(cause.code)).toBe("block_conflict");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Create `errors.ts`**

```ts
import {
  ConnectorError,
  type ConnectorErrorCode,
} from "@megasaver/connectors-shared";
import { z } from "zod";

export const genericCliConnectorErrorCodeSchema = z.enum([
  "target_unknown",
  "context_invalid",
  "block_conflict",
  "file_read_failed",
  "file_write_failed",
  "project_root_invalid",
]);
export type GenericCliConnectorErrorCode = z.infer<
  typeof genericCliConnectorErrorCodeSchema
>;

interface GenericCliConnectorErrorOptions {
  cause?: unknown;
  filePath?: string | null;
}

export class GenericCliConnectorError extends Error {
  readonly code: GenericCliConnectorErrorCode;
  readonly filePath: string | null;

  constructor(
    code: GenericCliConnectorErrorCode,
    message: string,
    options: GenericCliConnectorErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GenericCliConnectorError";
    this.code = genericCliConnectorErrorCodeSchema.parse(code);
    this.filePath = options.filePath ?? null;
  }
}

export function mapSharedErrorCode(code: ConnectorErrorCode): GenericCliConnectorErrorCode {
  switch (code) {
    case "context_invalid":
      return "context_invalid";
    case "block_conflict":
      return "block_conflict";
    case "file_read_failed":
      return "file_read_failed";
    case "file_write_failed":
      return "file_write_failed";
    case "target_path_invalid":
      return "project_root_invalid";
  }
}

export function wrapSharedConnectorError(
  error: unknown,
  filePath: string | null,
): never {
  if (error instanceof ConnectorError) {
    throw new GenericCliConnectorError(
      mapSharedErrorCode(error.code),
      error.message,
      { cause: error, filePath: filePath ?? error.filePath },
    );
  }
  throw error;
}
```

- [ ] **Step 4: Re-export**

Append to index:

```ts
export {
  GenericCliConnectorError,
  type GenericCliConnectorErrorCode,
  genericCliConnectorErrorCodeSchema,
} from "./errors.js";
```

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/generic-cli/src/errors.ts packages/connectors/generic-cli/src/index.ts packages/connectors/generic-cli/test/errors.test.ts
git commit -m "feat(connector-generic-cli): add GenericCliConnectorError"
```

---

## Task 22: generic-cli — `GenericCliContextSchema` + `assertGenericCliContext`

**Files:**
- Create: `packages/connectors/generic-cli/src/context.ts`
- Modify: `packages/connectors/generic-cli/src/index.ts`
- Create: `packages/connectors/generic-cli/test/fixtures.ts`
- Test: `packages/connectors/generic-cli/test/context.test.ts`

- [ ] **Step 1: Create fixtures**

`packages/connectors/generic-cli/test/fixtures.ts`:

```ts
import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/core";
import type { AgentId } from "@megasaver/shared";

export const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
export const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
export const MEMORY_ID = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const NOW = "2026-05-07T12:00:00.000Z";

export function buildCodexContext(overrides?: { agentId?: AgentId }) {
  const agentId: AgentId = overrides?.agentId ?? "codex";
  return {
    agentId,
    project: {
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    },
    session: null,
    memoryEntries: [],
  };
}
```

- [ ] **Step 2: Write failing test**

`packages/connectors/generic-cli/test/context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertGenericCliContext } from "../src/context.js";
import { GenericCliConnectorError } from "../src/errors.js";
import { codexTarget } from "../src/targets.js";
import { buildCodexContext } from "./fixtures.js";

describe("assertGenericCliContext", () => {
  it("accepts a matching codex context", () => {
    expect(() => assertGenericCliContext(buildCodexContext(), codexTarget)).not.toThrow();
  });

  it("rejects mismatched agentId", () => {
    expect(() =>
      assertGenericCliContext(buildCodexContext({ agentId: "claude-code" }), codexTarget),
    ).toThrow(GenericCliConnectorError);
  });

  it("rejects malformed input via shared schema", () => {
    expect(() => assertGenericCliContext({}, codexTarget)).toThrow(
      GenericCliConnectorError,
    );
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Create `context.ts`**

```ts
import {
  type ConnectorContext,
  ConnectorContextSchema,
} from "@megasaver/connectors-shared";
import { GenericCliConnectorError, wrapSharedConnectorError } from "./errors.js";
import type { ConnectorTarget } from "./targets.js";

export const GenericCliContextSchema = ConnectorContextSchema;

export function assertGenericCliContext(
  input: unknown,
  target: ConnectorTarget,
): ConnectorContext {
  let parsed: ConnectorContext;
  try {
    parsed = GenericCliContextSchema.parse(input);
  } catch (error) {
    throw new GenericCliConnectorError(
      "context_invalid",
      "Generic CLI context is invalid.",
      { cause: error },
    );
  }
  if (parsed.agentId !== target.agentId) {
    throw new GenericCliConnectorError(
      "context_invalid",
      `Context agentId "${parsed.agentId}" does not match target "${target.agentId}".`,
    );
  }
  return parsed;
}
```

`wrapSharedConnectorError` import is kept available but unused here; if biome flags it, drop it.

- [ ] **Step 5: Re-export**

Append to index:

```ts
export {
  assertGenericCliContext,
  GenericCliContextSchema,
} from "./context.js";
```

- [ ] **Step 6: Run, expect PASS**

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/generic-cli/src/context.ts packages/connectors/generic-cli/src/index.ts packages/connectors/generic-cli/test/fixtures.ts packages/connectors/generic-cli/test/context.test.ts
git commit -m "feat(connector-generic-cli): add context schema"
```

---

## Task 23: generic-cli — sync / read / write target helpers

**Files:**
- Create: `packages/connectors/generic-cli/src/sync.ts`
- Modify: `packages/connectors/generic-cli/src/index.ts`
- Test: `packages/connectors/generic-cli/test/sync.test.ts`

- [ ] **Step 1: Write failing test**

`packages/connectors/generic-cli/test/sync.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenericCliConnectorError } from "../src/errors.js";
import {
  readGenericCliTarget,
  syncGenericCliTarget,
  writeGenericCliTarget,
} from "../src/sync.js";
import { codexTarget } from "../src/targets.js";
import { buildCodexContext } from "./fixtures.js";

describe("syncGenericCliTarget", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-generic-cli-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("creates AGENTS.md with the rendered block when missing", async () => {
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written).toContain("Agent: codex");
  });

  it("preserves existing user content above the block", async () => {
    await writeFile(join(projectRoot, "AGENTS.md"), "# notes\n", "utf8");
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written.startsWith("# notes\n")).toBe(true);
  });

  it("replaces the block on second sync", async () => {
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    });
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written.match(/MEGA SAVER:BEGIN/g)?.length).toBe(1);
  });

  it("rejects context with mismatched agentId", async () => {
    await expect(
      syncGenericCliTarget({
        projectRoot,
        target: codexTarget,
        context: buildCodexContext({ agentId: "claude-code" }),
      }),
    ).rejects.toBeInstanceOf(GenericCliConnectorError);
  });

  it("rejects two-block files with block_conflict", async () => {
    await writeFile(
      join(projectRoot, "AGENTS.md"),
      "<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\n<!-- MEGA SAVER:BEGIN -->\n<!-- MEGA SAVER:END -->\n",
      "utf8",
    );
    const err = await syncGenericCliTarget({
      projectRoot,
      target: codexTarget,
      context: buildCodexContext(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GenericCliConnectorError);
    expect(err.code).toBe("block_conflict");
  });

  it("readGenericCliTarget returns null when file is missing", async () => {
    expect(await readGenericCliTarget({ projectRoot, target: codexTarget })).toBeNull();
  });

  it("writeGenericCliTarget round-trips with readGenericCliTarget", async () => {
    await writeGenericCliTarget({
      projectRoot,
      target: codexTarget,
      content: "raw\n",
    });
    expect(await readGenericCliTarget({ projectRoot, target: codexTarget })).toBe("raw\n");
  });

  it("rejects relative projectRoot with project_root_invalid", async () => {
    const err = await syncGenericCliTarget({
      projectRoot: "relative/path",
      target: codexTarget,
      context: buildCodexContext(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GenericCliConnectorError);
    expect(err.code).toBe("project_root_invalid");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Create `sync.ts`**

```ts
import {
  readTargetFile,
  syncTargetBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { assertGenericCliContext } from "./context.js";
import { GenericCliConnectorError, wrapSharedConnectorError } from "./errors.js";
import type { ConnectorTarget } from "./targets.js";
import type { ConnectorContext } from "@megasaver/connectors-shared";

interface SyncGenericCliTargetInput {
  projectRoot: string;
  target: ConnectorTarget;
  context: ConnectorContext;
}

interface ReadGenericCliTargetInput {
  projectRoot: string;
  target: ConnectorTarget;
}

interface WriteGenericCliTargetInput {
  projectRoot: string;
  target: ConnectorTarget;
  content: string;
}

export async function syncGenericCliTarget(
  input: SyncGenericCliTargetInput,
): Promise<string> {
  const filePath = await targetPath(input.projectRoot, input.target);
  const context = assertGenericCliContext(input.context, input.target);
  try {
    return await syncTargetBlock({ absPath: filePath, context });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return undefined as never;
  }
}

export async function readGenericCliTarget(
  input: ReadGenericCliTargetInput,
): Promise<string | null> {
  const filePath = await targetPath(input.projectRoot, input.target);
  try {
    return await readTargetFile(filePath);
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
    return null;
  }
}

export async function writeGenericCliTarget(
  input: WriteGenericCliTargetInput,
): Promise<void> {
  const filePath = await targetPath(input.projectRoot, input.target);
  try {
    await writeTargetFile({ absPath: filePath, content: input.content });
  } catch (error) {
    wrapSharedConnectorError(error, filePath);
  }
}

async function targetPath(projectRoot: string, target: ConnectorTarget): Promise<string> {
  await assertProjectRoot(projectRoot);
  return join(projectRoot, target.relativePath);
}

async function assertProjectRoot(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) throwInvalidProjectRoot(projectRoot);
  try {
    const projectRootStat = await stat(projectRoot);
    if (!projectRootStat.isDirectory()) throwInvalidProjectRoot(projectRoot);
  } catch (error) {
    if (error instanceof GenericCliConnectorError) throw error;
    throwInvalidProjectRoot(projectRoot, error);
  }
}

function throwInvalidProjectRoot(projectRoot: string, cause?: unknown): never {
  throw new GenericCliConnectorError(
    "project_root_invalid",
    "Project root must be an absolute path to an existing directory.",
    { cause, filePath: projectRoot },
  );
}
```

- [ ] **Step 4: Re-export**

Append to index:

```ts
export {
  readGenericCliTarget,
  syncGenericCliTarget,
  writeGenericCliTarget,
} from "./sync.js";
```

- [ ] **Step 5: Run, expect PASS**

```bash
pnpm --filter @megasaver/connector-generic-cli test
pnpm --filter @megasaver/connector-generic-cli typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/generic-cli/src/sync.ts packages/connectors/generic-cli/src/index.ts packages/connectors/generic-cli/test/sync.test.ts
git commit -m "feat(connector-generic-cli): add sync helpers"
```

---

## Task 24: generic-cli — public-export smoke

**Files:**
- Test: `packages/connectors/generic-cli/test/public-export.test.ts`

- [ ] **Step 1: Write smoke test**

`packages/connectors/generic-cli/test/public-export.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as pkg from "../dist/index.js";

describe("@megasaver/connector-generic-cli public exports", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-generic-cli-smoke-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("exposes the v0.1 surface", () => {
    expect(typeof pkg.findTarget).toBe("function");
    expect(pkg.codexTarget.id).toBe("codex");
    expect(typeof pkg.syncGenericCliTarget).toBe("function");
    expect(typeof pkg.readGenericCliTarget).toBe("function");
    expect(typeof pkg.writeGenericCliTarget).toBe("function");
    expect(typeof pkg.assertGenericCliContext).toBe("function");
    expect(typeof pkg.GenericCliConnectorError).toBe("function");
    expect(pkg.genericCliConnectorErrorCodeSchema).toBeDefined();
  });

  it("smoke syncs a codex target end-to-end", async () => {
    const NOW = "2026-05-07T12:00:00.000Z";
    const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
    const ctx = {
      agentId: "codex",
      project: {
        id: PROJECT_ID,
        name: "smoke",
        rootPath: projectRoot,
        createdAt: NOW,
        updatedAt: NOW,
      },
      session: null,
      memoryEntries: [],
    };
    const written = await pkg.syncGenericCliTarget({
      projectRoot,
      target: pkg.codexTarget,
      context: ctx as never,
    });
    expect(written).toContain("Agent: codex");
  });
});
```

- [ ] **Step 2: Run, expect PASS**

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/generic-cli/test/public-export.test.ts
git commit -m "test(connector-generic-cli): add public export smoke"
```

---

## Task 25: Add changesets for the two new packages

**Files:**
- Create: `.changeset/connectors-shared-init.md`
- Create: `.changeset/connector-generic-cli-init.md`
- Create: `.changeset/connector-claude-code-refactor.md`

- [ ] **Step 1: Write `.changeset/connectors-shared-init.md`**

```md
---
"@megasaver/connectors-shared": major
---

Initial publish of `@megasaver/connectors-shared`. Provides the
canonical block render/parse/upsert/remove helpers, the
`ConnectorContext` schema, and target-agnostic filesystem helpers
shared by every Mega Saver connector.
```

- [ ] **Step 2: Write `.changeset/connector-generic-cli-init.md`**

```md
---
"@megasaver/connector-generic-cli": major
---

Initial publish of `@megasaver/connector-generic-cli`. Manifest-driven
connector that synchronises a Mega Saver block into per-agent config
files. v0.1 ships the `codexTarget` (`AGENTS.md`).
```

- [ ] **Step 3: Write `.changeset/connector-claude-code-refactor.md`**

```md
---
"@megasaver/connector-claude-code": patch
---

Refactor `@megasaver/connector-claude-code` to delegate render, parse,
upsert, remove, and filesystem operations to
`@megasaver/connectors-shared`. Public surface and rendered block are
unchanged (regression test asserts byte-identical output).
```

- [ ] **Step 4: Commit**

```bash
git add .changeset
git commit -m "chore: add changesets for connectors-shared and generic-cli"
```

---

## Task 26: Final verification — `pnpm verify`

**Files:** none (gate)

- [ ] **Step 1: Run full workspace verify**

```bash
pnpm verify
```

Expected:

- lint clean
- typecheck across 5 packages (`shared`, `core`, `cli`, `connectors-shared`, `connector-claude-code`, `connector-generic-cli`) — note `cli` is unchanged but participates in the workspace verify
- test 8/8 turbo tasks (or whatever the workspace turbo task count is) all pass
- total tests ≥ 250

If any step fails, fix and re-run. No proceed without green.

- [ ] **Step 2: Capture evidence**

Save the tail of the verify output (test counts per package) into a temporary scratch note for the PR body. Do not commit the scratch note.

- [ ] **Step 3: No commit needed.**

---

## Task 27: Wiki updates

**Files:**
- Create: `wiki/entities/connectors-shared.md`
- Create: `wiki/entities/connectors-generic-cli.md`
- Modify: `wiki/entities/connectors-claude-code.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Write `wiki/entities/connectors-shared.md`**

```md
---
title: '@megasaver/connectors-shared'
tags: [entity, connectors, helpers, v0.1]
sources:
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
status: shipped
created: 2026-05-07
updated: 2026-05-07
---

# `@megasaver/connectors-shared`

Agent-agnostic helpers consumed by every Mega Saver connector. Lives
at `packages/connectors/shared`. Knows nothing about specific
agents — `agentId` is data carried through `ConnectorContext`.

## Public surface

- `MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END`
- `ConnectorContextSchema` (Zod, strict, refined)
- `ConnectorContext` type
- `assertConnectorContext(input)`
- `renderBlock(context)` — canonical markdown block
- `parseBlock(content)` — `{ before, block, after }` or throws `block_conflict`
- `upsertBlock({ existingContent, context })`
- `removeBlock(content)`
- `readTargetFile(absPath)` — `null` on ENOENT
- `writeTargetFile({ absPath, content })` — temp-file + rename
- `syncTargetBlock({ absPath, context })`
- `ConnectorError` + `connectorErrorCodeSchema` codes:
  `context_invalid`, `block_conflict`, `file_read_failed`,
  `file_write_failed`, `target_path_invalid`

## Boundaries

- Depends on `@megasaver/core` and `@megasaver/shared` only.
- Does not depend on any connector.
- Does not start agents, write CLI configs, or know agent identifiers
  except as data on `ConnectorContext.agentId`.

## Related

- [[entities/connectors-claude-code]]
- [[entities/connectors-generic-cli]]
- [[concepts/agent-agnostic-core]]
```

- [ ] **Step 2: Write `wiki/entities/connectors-generic-cli.md`**

```md
---
title: '@megasaver/connector-generic-cli'
tags: [entity, connector, generic-cli, v0.1]
sources:
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
status: shipped
created: 2026-05-07
updated: 2026-05-07
---

# `@megasaver/connector-generic-cli`

Manifest-driven connector. v0.1 ships one target: `codexTarget`
(writes `AGENTS.md` at project root, agent id `"codex"`).

## Public surface

- `ConnectorTarget` (interface): `{ id, agentId, relativePath }`
- `codexTarget`, `builtinTargets`, `findTarget(id)`
- `GenericCliContextSchema`, `assertGenericCliContext(input, target)`
- `syncGenericCliTarget({ projectRoot, target, context })`
- `readGenericCliTarget({ projectRoot, target })`
- `writeGenericCliTarget({ projectRoot, target, content })`
- `GenericCliConnectorError`, `genericCliConnectorErrorCodeSchema`
  codes: `target_unknown`, `context_invalid`, `block_conflict`,
  `file_read_failed`, `file_write_failed`, `project_root_invalid`

## Validation

- `context.agentId === target.agentId`.
- All shared schema rules (project/session/memory cross-id, sentinel
  injection rejection, max-20 memory).
- `projectRoot` absolute path to existing directory.

## Out of scope (v0.1)

- CLI integration (`mega connector sync` lands later).
- `.cursor/rules/*.mdc`, `.aider.conf.yml`, YAML/non-markdown targets.
- Optimistic concurrency.

## Related

- [[entities/connectors-shared]]
- [[entities/connectors-claude-code]]
- [[concepts/agent-agnostic-core]]
```

- [ ] **Step 3: Update `wiki/entities/connectors-claude-code.md`**

Append a new section just before `## Related`:

```md
## Refactor (2026-05-07)

`@megasaver/connector-claude-code` is now a thin wrapper over
`@megasaver/connectors-shared`. Render output is byte-identical to
the pre-refactor implementation; a regression fixture
(`test/regression-fixture.ts`) plus
`test/regression.test.ts` enforces this. Public surface unchanged;
`ClaudeCodeConnectorError` codes still exist as a 1:1 alias of the
shared error codes.
```

- [ ] **Step 4: Update `wiki/index.md`**

In the "Entities" list, add (alphabetic order with the existing
entries):

```
- [[entities/connectors-generic-cli]] — `@megasaver/connector-generic-cli` manifest-driven connector (v0.1 = Codex `AGENTS.md`).
- [[entities/connectors-shared]] — `@megasaver/connectors-shared` block helpers + context schema.
```

Remove `connectors-generic-cli` from the "Slot reserved" line.

In the "Quick links by question" table, add:

```
| What does the generic-CLI connector ship?         | [[entities/connectors-generic-cli]]              |
| Where do shared connector helpers live?           | [[entities/connectors-shared]]                   |
```

Update Status section to:

```
generic-cli connector merged: `@megasaver/connectors-shared` plus
`@megasaver/connector-generic-cli` (Codex `AGENTS.md` target) on
`origin/main`. Claude-code connector refactored to consume shared
helpers; render byte-identical. Next slot: Session CRUD, or the
`mega connector sync` CLI command spec.
```

- [ ] **Step 5: Append `wiki/log.md` entry**

```md
## [2026-05-07] schema | generic-cli connector implemented

Implemented `@megasaver/connectors-shared` (block render/parse/upsert
/remove + ConnectorContext schema + filesystem helpers) and
`@megasaver/connector-generic-cli` (manifest-driven connector with
`codexTarget` writing `AGENTS.md`). Refactored
`@megasaver/connector-claude-code` to consume the shared helpers;
render output byte-identical (regression fixture asserts). `AgentId`
enum extended with `"codex"`. Evidence before review: `pnpm verify`
green across 6 packages, total tests ≥ 250, smoke syncs codex target
into a tmp project root and prints the rendered `AGENTS.md` content.
```

- [ ] **Step 6: Commit**

```bash
git add wiki
git commit -m "docs(wiki): record generic-cli connector"
```

---

## Task 28: Pre-merge gate — push, open PR, dispatch review

**Files:** none (process)

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/generic-cli-connector
```

- [ ] **Step 2: Open draft PR**

```bash
gh pr create --draft \
  --base main \
  --title "feat: generic-cli connector + connectors-shared (HIGH)" \
  --body "$(cat <<'EOF'
## Summary
- New `@megasaver/connectors-shared` package: block render/parse/upsert/remove, `ConnectorContext` schema, filesystem helpers.
- New `@megasaver/connector-generic-cli` package: manifest-driven, v0.1 ships `codexTarget` (`AGENTS.md`).
- Refactor `@megasaver/connector-claude-code` to delegate to shared. Public surface unchanged. Render byte-identical.
- Extend `AgentId` enum with `"codex"`.

## Spec / Plan
- Spec: docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
- Plan: docs/superpowers/plans/2026-05-07-generic-cli-connector-plan.md

## Verification
- `pnpm verify` green: lint, typecheck, test across 6 packages (paste counts).
- Bit-identical claude-code render: see `packages/connectors/claude-code/test/regression.test.ts`.

## Risk
HIGH (CLAUDE.md §12). Worktree used. Two-stage external review
(`code-reviewer` + `critic`) required before merge.

## Residual risks (deferred)
- No optimistic concurrency on managed-block writes (matches claude-code v0.1).
- No `.cursor/rules` or `.aider.conf.yml` targets.
- No CLI integration yet (library-only).
EOF
)"
```

- [ ] **Step 3: Dispatch reviewers (separate active context)**

Per `CLAUDE.md` §9: author and reviewer agents must NEVER share an
active context. Open a new session and dispatch:

- `Agent({ subagent_type: "code-reviewer", prompt: "Review feat/generic-cli-connector at HEAD. Check public surface, error mapping, byte-identical render, test coverage, biome / TS strict adherence." })`
- `Agent({ subagent_type: "critic", prompt: "Adversarial review of feat/generic-cli-connector at HEAD. Check boundary leaks (claude-code knowledge in shared), refactor parity gaps, manifest API soundness for future targets." })`

Wait for both to return Approved with no Critical/Important findings. If changes-requested, fix and re-dispatch on the new HEAD.

- [ ] **Step 4: Mark PR ready, merge**

After both reviewers approve, mark the PR ready for review and merge
via the GitHub UI or:

```bash
gh pr ready
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Local cleanup**

```bash
cd /Users/halitozger/Desktop/MegaSaver
git checkout main
git pull --ff-only
git worktree remove .worktrees/generic-cli-connector
git branch -D feat/generic-cli-connector
```

- [ ] **Step 6: Append final log entry**

In `wiki/log.md` append:

```md
## [2026-05-07] schema | generic-cli connector pushed to main

PR #N (link) merged into `main` (merge commit <sha>).
`@megasaver/connectors-shared`, `@megasaver/connector-generic-cli`,
and the refactored `@megasaver/connector-claude-code` are now part of
`origin/main`. `AgentId` includes `"codex"`. Local `main` synced via
`git pull --ff-only`; worktree removed; branch deleted. Tracked
follow-ups: M1 unicode normalization (still open), M2 advisory
locking, M5 `mega connector sync` CLI spec.
```

Commit on main directly with `docs(wiki): record generic-cli merge`
and push.

---

## Self-review

After writing all tasks, verify against the spec:

**Spec coverage:**

- §1 goal/scope — Tasks 1–28 collectively realise it.
- §2 topology — Tasks 2, 19 scaffold the two new packages; Task 12 wires the new dep into claude-code.
- §3 connectors-shared API — Tasks 3 (constants), 4 (errors), 5 (context), 6 (render), 7 (parse), 8 (upsert/remove), 9 (filesystem), 10 (smoke).
- §4 claude-code refactor — Tasks 11 (baseline), 13–17 (refactor steps), 18 (regression).
- §5 generic-cli API — Tasks 19–24.
- §6 test strategy — every shared / claude-code regression / generic-cli test file is covered by a task.
- §7 risk / residual / changesets — Task 25 (changesets), Task 26 (verify), Task 28 (review gate).

**Placeholder scan:** No "TBD" / "TODO" / "fill in" remain. The Task 11 baseline JSON literal placeholder (the inline JSON in Step 3) is intentional and explicitly instructs the engineer to paste the captured content.

**Type consistency:** `ConnectorContextSchema` includes `agentId` from §3 / Task 5 onwards; every `buildContext` fixture sets it; every render/upsert/sync test that constructs a context sets it; the regression test in Task 18 sets it. `ConnectorTarget` shape is used identically across Tasks 20, 22, 23. Error code unions match between `connectors-shared` (5 codes) and the wrapper packages (mapped via `mapSharedErrorCode`).

**Unused import drift:** Tasks 17 and 22 explicitly note that biome may flag unused imports — drop them then.
