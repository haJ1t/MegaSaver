# Claude Code Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@megasaver/connector-claude-code`, a strict TypeScript adapter that manages one Mega Saver block inside root `CLAUDE.md`.

**Architecture:** The connector is a leaf package at `packages/connectors/claude-code`. It imports core schemas for validation, renders deterministic markdown, preserves human-authored `CLAUDE.md` content outside managed sentinels, and exposes narrow async filesystem helpers that only touch `<projectRoot>/CLAUDE.md`.

**Tech Stack:** Node 22, strict TypeScript ESM, Zod, pnpm workspaces, tsup, Vitest, Biome, Changesets.

---

## File Map

- `packages/connectors/claude-code/package.json` — package metadata, exports, scripts, dependencies.
- `packages/connectors/claude-code/tsconfig.json` — production TS config.
- `packages/connectors/claude-code/tsconfig.test.json` — test TS config.
- `packages/connectors/claude-code/tsup.config.ts` — ESM build config.
- `packages/connectors/claude-code/vitest.config.ts` — Vitest config.
- `packages/connectors/claude-code/src/constants.ts` — agent id, filename, sentinels.
- `packages/connectors/claude-code/src/errors.ts` — typed connector errors.
- `packages/connectors/claude-code/src/context.ts` — `ClaudeCodeContextSchema` and validation helpers.
- `packages/connectors/claude-code/src/markdown.ts` — render/parse/upsert/remove helpers.
- `packages/connectors/claude-code/src/filesystem.ts` — root validation and file I/O.
- `packages/connectors/claude-code/src/index.ts` — public exports.
- `packages/connectors/claude-code/test/errors.test.ts` — typed error tests.
- `packages/connectors/claude-code/test/context.test.ts` — context schema tests.
- `packages/connectors/claude-code/test/markdown.test.ts` — renderer/parser/update tests.
- `packages/connectors/claude-code/test/filesystem.test.ts` — temp-dir filesystem tests.
- `.changeset/claude-code-connector.md` — new package changeset.
- `wiki/entities/connectors-claude-code.md` — concrete wiki surface.
- `wiki/index.md` — status and quick link.
- `wiki/log.md` — append-only implementation evidence.

## Shared Test Fixtures

Use these UUID literals across connector tests so branded schemas parse cleanly:

```ts
import type { MemoryEntry, Project, Session } from "@megasaver/core";
import {
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";

export const projectId = projectIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
export const sessionId = sessionIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);
export const projectMemoryId = memoryEntryIdSchema.parse(
  "33333333-3333-4333-8333-333333333333",
);
export const sessionMemoryId = memoryEntryIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);

export const project: Project = {
  id: projectId,
  name: "Mega Saver",
  rootPath: "/tmp/megasaver",
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

export const session: Session = {
  id: sessionId,
  projectId,
  agentId: "claude-code",
  riskLevel: "high",
  title: "Connector sync",
  startedAt: "2026-05-06T00:00:00.000Z",
  endedAt: null,
};

export const projectMemory: MemoryEntry = {
  id: projectMemoryId,
  projectId,
  sessionId: null,
  scope: "project",
  content: "Use wiki-first context discipline.",
  createdAt: "2026-05-06T00:00:00.000Z",
};

export const sessionMemory: MemoryEntry = {
  id: sessionMemoryId,
  projectId,
  sessionId,
  scope: "session",
  content: "Connector writes only the managed block.",
  createdAt: "2026-05-06T00:00:00.000Z",
};
```

---

### Task 1: Package Scaffold

**Files:**
- Create: `packages/connectors/claude-code/package.json`
- Create: `packages/connectors/claude-code/tsconfig.json`
- Create: `packages/connectors/claude-code/tsconfig.test.json`
- Create: `packages/connectors/claude-code/tsup.config.ts`
- Create: `packages/connectors/claude-code/vitest.config.ts`
- Create: `packages/connectors/claude-code/src/index.ts`

- [ ] **Step 1: Write the minimal public export smoke test**

Create `packages/connectors/claude-code/test/public-export.test.ts`:

```ts
import { describe, expect, test } from "vitest";

describe("public exports", () => {
  test("exports the Claude Code agent id", async () => {
    const connector = await import("../src/index.js");

    expect(connector.CLAUDE_CODE_AGENT_ID).toBe("claude-code");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test
```

Expected: command fails because the package does not exist in the workspace graph.

- [ ] **Step 3: Create the package scaffold**

Create `packages/connectors/claude-code/package.json`:

```json
{
  "name": "@megasaver/connector-claude-code",
  "version": "0.0.0",
  "private": true,
  "description": "Claude Code connector for Mega Saver.",
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
    "test": "vitest run",
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

Create `packages/connectors/claude-code/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "incremental": false,
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

Create `packages/connectors/claude-code/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*", "test/**/*"]
}
```

Create `packages/connectors/claude-code/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
```

Create `packages/connectors/claude-code/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

Create `packages/connectors/claude-code/src/constants.ts`:

```ts
import type { AgentId } from "@megasaver/shared";

export const CLAUDE_CODE_AGENT_ID = "claude-code" satisfies AgentId;
export const CLAUDE_MD_FILE = "CLAUDE.md";
export const MEGA_SAVER_BLOCK_START = "<!-- MEGA SAVER:BEGIN -->";
export const MEGA_SAVER_BLOCK_END = "<!-- MEGA SAVER:END -->";
```

Create `packages/connectors/claude-code/src/index.ts`:

```ts
export * from "./constants.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/connector-claude-code typecheck
pnpm --filter @megasaver/connector-claude-code build
```

Expected: all pass; connector appears in turbo package scope.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/claude-code
git commit -m "feat(connector): scaffold claude code package"
```

---

### Task 2: Typed Connector Errors

**Files:**
- Create: `packages/connectors/claude-code/src/errors.ts`
- Modify: `packages/connectors/claude-code/src/index.ts`
- Create: `packages/connectors/claude-code/test/errors.test.ts`

- [ ] **Step 1: Write failing error tests**

Create `packages/connectors/claude-code/test/errors.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  type ClaudeCodeConnectorErrorCode,
} from "../src/index.js";

describe("ClaudeCodeConnectorError", () => {
  test("carries typed code and optional file path", () => {
    const error = new ClaudeCodeConnectorError(
      "claude_md_read_failed",
      "Could not read CLAUDE.md.",
      { filePath: "/tmp/project/CLAUDE.md" },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ClaudeCodeConnectorError");
    expect(error.code).toBe("claude_md_read_failed");
    expect(error.filePath).toBe("/tmp/project/CLAUDE.md");
    expect(error.message).toBe("Could not read CLAUDE.md.");
  });

  test("exposes all planned error codes as a type", () => {
    const codes: ClaudeCodeConnectorErrorCode[] = [
      "claude_md_context_invalid",
      "claude_md_block_conflict",
      "claude_md_read_failed",
      "claude_md_write_failed",
      "project_root_invalid",
    ];

    expect(codes).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/errors.test.ts
```

Expected: FAIL because `ClaudeCodeConnectorError` is not exported.

- [ ] **Step 3: Implement typed errors**

Create `packages/connectors/claude-code/src/errors.ts`:

```ts
export type ClaudeCodeConnectorErrorCode =
  | "claude_md_context_invalid"
  | "claude_md_block_conflict"
  | "claude_md_read_failed"
  | "claude_md_write_failed"
  | "project_root_invalid";

export interface ClaudeCodeConnectorErrorOptions {
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
    super(message, { cause: options.cause });
    this.name = "ClaudeCodeConnectorError";
    this.code = code;
    this.filePath = options.filePath ?? null;
  }
}
```

Modify `packages/connectors/claude-code/src/index.ts`:

```ts
export * from "./constants.js";
export * from "./errors.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/errors.test.ts
pnpm --filter @megasaver/connector-claude-code typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/claude-code/src/errors.ts packages/connectors/claude-code/src/index.ts packages/connectors/claude-code/test/errors.test.ts
git commit -m "feat(connector): add typed errors"
```

---

### Task 3: Context Schema

**Files:**
- Create: `packages/connectors/claude-code/src/context.ts`
- Modify: `packages/connectors/claude-code/src/index.ts`
- Create: `packages/connectors/claude-code/test/context.test.ts`

- [ ] **Step 1: Write failing context tests**

Create `packages/connectors/claude-code/test/context.test.ts` using the Shared Test Fixtures from this plan:

```ts
import { describe, expect, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  ClaudeCodeContextSchema,
  MEGA_SAVER_BLOCK_START,
  assertClaudeCodeContext,
} from "../src/index.js";
import {
  project,
  projectMemory,
  session,
  sessionMemory,
} from "./fixtures.js";

describe("ClaudeCodeContextSchema", () => {
  test("accepts a valid Claude Code context", () => {
    const parsed = ClaudeCodeContextSchema.parse({
      project,
      session,
      memoryEntries: [projectMemory, sessionMemory],
    });

    expect(parsed.session?.agentId).toBe("claude-code");
    expect(parsed.memoryEntries).toHaveLength(2);
  });

  test("rejects a session from another agent", () => {
    const result = ClaudeCodeContextSchema.safeParse({
      project,
      session: { ...session, agentId: "generic-cli" },
      memoryEntries: [projectMemory],
    });

    expect(result.success).toBe(false);
  });

  test("rejects session memory without matching session", () => {
    const result = ClaudeCodeContextSchema.safeParse({
      project,
      session: null,
      memoryEntries: [sessionMemory],
    });

    expect(result.success).toBe(false);
  });

  test("rejects sentinel injection in rendered values", () => {
    const result = ClaudeCodeContextSchema.safeParse({
      project: { ...project, name: MEGA_SAVER_BLOCK_START },
      session,
      memoryEntries: [projectMemory],
    });

    expect(result.success).toBe(false);
  });

  test("assertClaudeCodeContext throws a typed connector error", () => {
    expect(() =>
      assertClaudeCodeContext({
        project,
        session: { ...session, agentId: "generic-cli" },
        memoryEntries: [],
      }),
    ).toThrow(ClaudeCodeConnectorError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/context.test.ts
```

Expected: FAIL because `context.ts` and `test/fixtures.ts` do not exist.

- [ ] **Step 3: Add fixtures and implement schema**

Create `packages/connectors/claude-code/test/fixtures.ts` using the Shared Test Fixtures section exactly.

Create `packages/connectors/claude-code/src/context.ts`:

```ts
import {
  memoryEntrySchema,
  projectSchema,
  sessionSchema,
} from "@megasaver/core";
import { z } from "zod";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "./constants.js";
import { ClaudeCodeConnectorError } from "./errors.js";

function containsSentinel(value: string): boolean {
  return (
    value.includes(MEGA_SAVER_BLOCK_START) ||
    value.includes(MEGA_SAVER_BLOCK_END)
  );
}

export const ClaudeCodeContextSchema = z
  .object({
    project: projectSchema,
    session: sessionSchema.nullable(),
    memoryEntries: z.array(memoryEntrySchema).max(20),
  })
  .strict()
  .superRefine((context, ctx) => {
    if (context.session !== null) {
      if (context.session.projectId !== context.project.id) {
        ctx.addIssue({
          code: "custom",
          message: "Session must belong to the selected project.",
          path: ["session", "projectId"],
        });
      }

      if (context.session.agentId !== "claude-code") {
        ctx.addIssue({
          code: "custom",
          message: "Session agentId must be claude-code.",
          path: ["session", "agentId"],
        });
      }

      if (context.session.title !== null && containsSentinel(context.session.title)) {
        ctx.addIssue({
          code: "custom",
          message: "Session title must not contain Mega Saver sentinels.",
          path: ["session", "title"],
        });
      }
    }

    if (containsSentinel(context.project.name)) {
      ctx.addIssue({
        code: "custom",
        message: "Project name must not contain Mega Saver sentinels.",
        path: ["project", "name"],
      });
    }

    for (const [index, entry] of context.memoryEntries.entries()) {
      if (entry.projectId !== context.project.id) {
        ctx.addIssue({
          code: "custom",
          message: "Memory entry must belong to the selected project.",
          path: ["memoryEntries", index, "projectId"],
        });
      }

      if (entry.scope === "session") {
        if (context.session === null || entry.sessionId !== context.session.id) {
          ctx.addIssue({
            code: "custom",
            message: "Session memory must match the selected session.",
            path: ["memoryEntries", index, "sessionId"],
          });
        }
      }

      if (containsSentinel(entry.content)) {
        ctx.addIssue({
          code: "custom",
          message: "Memory content must not contain Mega Saver sentinels.",
          path: ["memoryEntries", index, "content"],
        });
      }
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

Modify `packages/connectors/claude-code/src/index.ts`:

```ts
export * from "./constants.js";
export * from "./context.js";
export * from "./errors.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/context.test.ts
pnpm --filter @megasaver/connector-claude-code typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/claude-code/src/context.ts packages/connectors/claude-code/src/index.ts packages/connectors/claude-code/test/context.test.ts packages/connectors/claude-code/test/fixtures.ts
git commit -m "feat(connector): validate claude context"
```

---

### Task 4: Markdown Render and Block Parser

**Files:**
- Create: `packages/connectors/claude-code/src/markdown.ts`
- Modify: `packages/connectors/claude-code/src/index.ts`
- Create: `packages/connectors/claude-code/test/markdown.test.ts`

- [ ] **Step 1: Write failing markdown tests**

Create `packages/connectors/claude-code/test/markdown.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  parseClaudeMd,
  removeMegaSaverBlock,
  renderClaudeCodeContext,
  upsertMegaSaverBlock,
} from "../src/index.js";
import {
  project,
  projectMemory,
  session,
  sessionMemory,
} from "./fixtures.js";

describe("renderClaudeCodeContext", () => {
  test("renders deterministic context with project and session memory", () => {
    const rendered = renderClaudeCodeContext({
      project,
      session,
      memoryEntries: [projectMemory, sessionMemory],
    });

    expect(rendered).toContain(MEGA_SAVER_BLOCK_START);
    expect(rendered).toContain("Agent: claude-code");
    expect(rendered).toContain(`Project: Mega Saver (${project.id})`);
    expect(rendered).toContain("Session: Connector sync");
    expect(rendered).toContain("Risk: high");
    expect(rendered).toContain(`[project:${projectMemory.id}] Use wiki-first context discipline.`);
    expect(rendered).toContain(`[session:${sessionMemory.id}] Connector writes only the managed block.`);
    expect(rendered.endsWith(`${MEGA_SAVER_BLOCK_END}\n`)).toBe(true);
  });

  test("renders none when no memory entries are selected", () => {
    expect(
      renderClaudeCodeContext({ project, session: null, memoryEntries: [] }),
    ).toContain("- none");
  });
});

describe("parseClaudeMd", () => {
  test("reports no managed block for human-only content", () => {
    const parsed = parseClaudeMd("# Human\n");

    expect(parsed.hasManagedBlock).toBe(false);
    expect(parsed.contentBeforeBlock).toBe("# Human\n");
    expect(parsed.managedBlock).toBeNull();
    expect(parsed.contentAfterBlock).toBe("");
  });

  test("splits exactly one managed block", () => {
    const block = renderClaudeCodeContext({
      project,
      session,
      memoryEntries: [projectMemory],
    });
    const parsed = parseClaudeMd(`# Human\n\n${block}\n# After\n`);

    expect(parsed.hasManagedBlock).toBe(true);
    expect(parsed.contentBeforeBlock).toBe("# Human\n\n");
    expect(parsed.managedBlock).toBe(block);
    expect(parsed.contentAfterBlock).toBe("\n# After\n");
  });

  test("rejects conflicting sentinels", () => {
    const content = `${MEGA_SAVER_BLOCK_START}\n${MEGA_SAVER_BLOCK_END}\n${MEGA_SAVER_BLOCK_START}\n${MEGA_SAVER_BLOCK_END}\n`;

    expect(() => parseClaudeMd(content)).toThrow(ClaudeCodeConnectorError);
  });
});

describe("upsertMegaSaverBlock", () => {
  test("appends managed block after human content", () => {
    const updated = upsertMegaSaverBlock({
      existingContent: "# Human\n",
      context: { project, session, memoryEntries: [projectMemory] },
    });

    expect(updated.startsWith("# Human\n\n")).toBe(true);
    expect(updated.match(/MEGA SAVER:BEGIN/g)).toHaveLength(1);
  });

  test("replaces existing managed block without duplicating it", () => {
    const first = upsertMegaSaverBlock({
      existingContent: "# Human\n",
      context: { project, session, memoryEntries: [projectMemory] },
    });
    const second = upsertMegaSaverBlock({
      existingContent: first,
      context: { project, session, memoryEntries: [sessionMemory] },
    });

    expect(second.match(/MEGA SAVER:BEGIN/g)).toHaveLength(1);
    expect(second).not.toContain(projectMemory.content);
    expect(second).toContain(sessionMemory.content);
  });
});

describe("removeMegaSaverBlock", () => {
  test("removes only the managed block", () => {
    const content = upsertMegaSaverBlock({
      existingContent: "# Human\n",
      context: { project, session, memoryEntries: [projectMemory] },
    });

    expect(removeMegaSaverBlock(content)).toBe("# Human\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/markdown.test.ts
```

Expected: FAIL because markdown helpers are not exported.

- [ ] **Step 3: Implement markdown helpers**

Create `packages/connectors/claude-code/src/markdown.ts`:

```ts
import type { MemoryEntry } from "@megasaver/core";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "./constants.js";
import { assertClaudeCodeContext, type ClaudeCodeContext } from "./context.js";
import { ClaudeCodeConnectorError } from "./errors.js";

export interface ClaudeMdDocument {
  hasManagedBlock: boolean;
  contentBeforeBlock: string;
  managedBlock: string | null;
  contentAfterBlock: string;
}

function lineOffsets(content: string): Array<{ text: string; start: number; end: number }> {
  const matches = content.matchAll(/[^\n]*(?:\n|$)/g);
  const lines: Array<{ text: string; start: number; end: number }> = [];

  for (const match of matches) {
    if (match[0] === "" && match.index === content.length) {
      continue;
    }

    lines.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return lines;
}

function normalizedLine(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function renderMemoryEntry(entry: MemoryEntry): string {
  const [firstLine = "", ...remainingLines] = entry.content.split(/\r?\n/);
  const scope = entry.scope;
  const lines = [`- [${scope}:${entry.id}] ${firstLine}`];

  for (const line of remainingLines) {
    lines.push(`  ${line}`);
  }

  return lines.join("\n");
}

export function renderClaudeCodeContext(input: ClaudeCodeContext): string {
  const context = assertClaudeCodeContext(input);
  const sessionLabel =
    context.session?.title ?? context.session?.id ?? "none";
  const riskLabel = context.session?.riskLevel ?? "none";
  const memory =
    context.memoryEntries.length === 0
      ? "- none"
      : context.memoryEntries.map(renderMemoryEntry).join("\n");

  return [
    MEGA_SAVER_BLOCK_START,
    "# Mega Saver Context",
    "",
    "Agent: claude-code",
    `Project: ${context.project.name} (${context.project.id})`,
    `Session: ${sessionLabel}`,
    `Risk: ${riskLabel}`,
    "",
    "## Memory",
    "",
    memory,
    MEGA_SAVER_BLOCK_END,
    "",
  ].join("\n");
}

export function parseClaudeMd(content: string): ClaudeMdDocument {
  const lines = lineOffsets(content);
  const startLines = lines.filter(
    (line) => normalizedLine(line.text) === MEGA_SAVER_BLOCK_START,
  );
  const endLines = lines.filter(
    (line) => normalizedLine(line.text) === MEGA_SAVER_BLOCK_END,
  );

  if (startLines.length === 0 && endLines.length === 0) {
    return {
      hasManagedBlock: false,
      contentBeforeBlock: content,
      managedBlock: null,
      contentAfterBlock: "",
    };
  }

  if (startLines.length !== 1 || endLines.length !== 1) {
    throw new ClaudeCodeConnectorError(
      "claude_md_block_conflict",
      "CLAUDE.md contains conflicting Mega Saver sentinels.",
    );
  }

  const [startLine] = startLines;
  const [endLine] = endLines;

  if (endLine.start < startLine.start) {
    throw new ClaudeCodeConnectorError(
      "claude_md_block_conflict",
      "CLAUDE.md Mega Saver end sentinel appears before the start sentinel.",
    );
  }

  return {
    hasManagedBlock: true,
    contentBeforeBlock: content.slice(0, startLine.start),
    managedBlock: content.slice(startLine.start, endLine.end),
    contentAfterBlock: content.slice(endLine.end),
  };
}

function trimTrailingBlankLines(content: string): string {
  return content.replace(/[ \t]*(?:\r?\n)+$/u, "");
}

function trimLeadingBlankLines(content: string): string {
  return content.replace(/^(?:[ \t]*\r?\n)+/u, "");
}

export function upsertMegaSaverBlock(input: {
  existingContent: string;
  context: ClaudeCodeContext;
}): string {
  const block = renderClaudeCodeContext(input.context);
  const parsed = parseClaudeMd(input.existingContent);
  const before = parsed.hasManagedBlock
    ? parsed.contentBeforeBlock
    : input.existingContent;
  const after = parsed.hasManagedBlock ? parsed.contentAfterBlock : "";
  const normalizedBefore = trimTrailingBlankLines(before);
  const normalizedAfter = trimLeadingBlankLines(after);
  const prefix = normalizedBefore.length === 0 ? "" : `${normalizedBefore}\n\n`;
  const suffix = normalizedAfter.length === 0 ? "" : `\n${normalizedAfter}`;

  return `${prefix}${block}${suffix}`;
}

export function removeMegaSaverBlock(content: string): string {
  const parsed = parseClaudeMd(content);

  if (!parsed.hasManagedBlock) {
    return content;
  }

  const before = trimTrailingBlankLines(parsed.contentBeforeBlock);
  const after = trimLeadingBlankLines(parsed.contentAfterBlock);
  const joined =
    before.length > 0 && after.length > 0
      ? `${before}\n\n${after}`
      : `${before}${after}`;

  return joined.length === 0 ? "" : `${trimTrailingBlankLines(joined)}\n`;
}
```

Modify `packages/connectors/claude-code/src/index.ts`:

```ts
export * from "./constants.js";
export * from "./context.js";
export * from "./errors.js";
export * from "./markdown.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/markdown.test.ts
pnpm --filter @megasaver/connector-claude-code typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/claude-code/src/markdown.ts packages/connectors/claude-code/src/index.ts packages/connectors/claude-code/test/markdown.test.ts
git commit -m "feat(connector): manage claude md block"
```

---

### Task 5: Filesystem Helpers

**Files:**
- Create: `packages/connectors/claude-code/src/filesystem.ts`
- Modify: `packages/connectors/claude-code/src/index.ts`
- Create: `packages/connectors/claude-code/test/filesystem.test.ts`

- [ ] **Step 1: Write failing filesystem tests**

Create `packages/connectors/claude-code/test/filesystem.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  CLAUDE_MD_FILE,
  readClaudeMd,
  syncClaudeMdContext,
  writeClaudeMd,
} from "../src/index.js";
import { project, projectMemory, session } from "./fixtures.js";

const tempRoots: string[] = [];

async function tempProjectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "megasaver-claude-code-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("readClaudeMd", () => {
  test("returns null when root CLAUDE.md is absent", async () => {
    const root = await tempProjectRoot();

    await expect(readClaudeMd(root)).resolves.toBeNull();
  });

  test("rejects relative project roots", async () => {
    await expect(readClaudeMd("relative")).rejects.toThrow(
      ClaudeCodeConnectorError,
    );
  });
});

describe("writeClaudeMd", () => {
  test("writes only root CLAUDE.md", async () => {
    const root = await tempProjectRoot();

    await writeClaudeMd({ projectRoot: root, content: "# Human\n" });

    await expect(readFile(join(root, CLAUDE_MD_FILE), "utf8")).resolves.toBe(
      "# Human\n",
    );
  });

  test("rejects missing project roots", async () => {
    const root = join(tmpdir(), "megasaver-missing-root");

    await expect(
      writeClaudeMd({ projectRoot: root, content: "# Human\n" }),
    ).rejects.toThrow(ClaudeCodeConnectorError);
  });
});

describe("syncClaudeMdContext", () => {
  test("preserves human content while writing managed context", async () => {
    const root = await tempProjectRoot();
    await writeFile(join(root, CLAUDE_MD_FILE), "# Human\n", "utf8");

    const written = await syncClaudeMdContext({
      projectRoot: root,
      context: { project, session, memoryEntries: [projectMemory] },
    });

    expect(written.startsWith("# Human\n\n")).toBe(true);
    expect(written).toContain("Mega Saver Context");
    await expect(readFile(join(root, CLAUDE_MD_FILE), "utf8")).resolves.toBe(
      written,
    );
  });

  test("rejects a file-shaped project root", async () => {
    const root = await tempProjectRoot();
    const fileRoot = join(root, "not-a-dir");
    await writeFile(fileRoot, "x", "utf8");

    await expect(
      syncClaudeMdContext({
        projectRoot: fileRoot,
        context: { project, session, memoryEntries: [] },
      }),
    ).rejects.toThrow(ClaudeCodeConnectorError);
  });

  test("does not write nested .claude instructions", async () => {
    const root = await tempProjectRoot();
    await mkdir(join(root, ".claude"), { recursive: true });

    await syncClaudeMdContext({
      projectRoot: root,
      context: { project, session, memoryEntries: [] },
    });

    await expect(readClaudeMd(join(root, ".claude"))).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/filesystem.test.ts
```

Expected: FAIL because filesystem helpers are not exported.

- [ ] **Step 3: Implement filesystem helpers**

Create `packages/connectors/claude-code/src/filesystem.ts`:

```ts
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { CLAUDE_MD_FILE } from "./constants.js";
import { type ClaudeCodeContext } from "./context.js";
import { ClaudeCodeConnectorError } from "./errors.js";
import { upsertMegaSaverBlock } from "./markdown.js";

async function assertProjectRoot(projectRoot: string): Promise<void> {
  if (!isAbsolute(projectRoot)) {
    throw new ClaudeCodeConnectorError(
      "project_root_invalid",
      "Project root must be an absolute path.",
      { filePath: projectRoot },
    );
  }

  try {
    const rootStat = await stat(projectRoot);

    if (!rootStat.isDirectory()) {
      throw new ClaudeCodeConnectorError(
        "project_root_invalid",
        "Project root must be a directory.",
        { filePath: projectRoot },
      );
    }
  } catch (error) {
    if (error instanceof ClaudeCodeConnectorError) {
      throw error;
    }

    throw new ClaudeCodeConnectorError(
      "project_root_invalid",
      "Project root is not accessible.",
      { cause: error, filePath: projectRoot },
    );
  }
}

function claudeMdPath(projectRoot: string): string {
  return join(projectRoot, CLAUDE_MD_FILE);
}

export async function readClaudeMd(projectRoot: string): Promise<string | null> {
  await assertProjectRoot(projectRoot);
  const filePath = claudeMdPath(projectRoot);

  try {
    await access(filePath, fsConstants.F_OK);
  } catch {
    return null;
  }

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new ClaudeCodeConnectorError(
      "claude_md_read_failed",
      "Could not read CLAUDE.md.",
      { cause: error, filePath },
    );
  }
}

export async function writeClaudeMd(input: {
  projectRoot: string;
  content: string;
}): Promise<void> {
  await assertProjectRoot(input.projectRoot);
  const filePath = claudeMdPath(input.projectRoot);
  const tempPath = join(input.projectRoot, `.CLAUDE.md.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, input.content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    throw new ClaudeCodeConnectorError(
      "claude_md_write_failed",
      "Could not write CLAUDE.md.",
      { cause: error, filePath },
    );
  }
}

export async function syncClaudeMdContext(input: {
  projectRoot: string;
  context: ClaudeCodeContext;
}): Promise<string> {
  const existingContent = (await readClaudeMd(input.projectRoot)) ?? "";
  const content = upsertMegaSaverBlock({
    existingContent,
    context: input.context,
  });

  await writeClaudeMd({ projectRoot: input.projectRoot, content });

  return content;
}
```

Modify `packages/connectors/claude-code/src/index.ts`:

```ts
export * from "./constants.js";
export * from "./context.js";
export * from "./errors.js";
export * from "./filesystem.js";
export * from "./markdown.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test -- test/filesystem.test.ts
pnpm --filter @megasaver/connector-claude-code typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/claude-code/src/filesystem.ts packages/connectors/claude-code/src/index.ts packages/connectors/claude-code/test/filesystem.test.ts
git commit -m "feat(connector): sync claude md file"
```

---

### Task 6: Full Package Verification and Changeset

**Files:**
- Create: `.changeset/claude-code-connector.md`
- Modify: package build artifacts only through commands; do not commit `dist`.

- [ ] **Step 1: Write changeset**

Create `.changeset/claude-code-connector.md`:

```md
---
"@megasaver/connector-claude-code": minor
---

Add the initial Claude Code connector with deterministic root `CLAUDE.md`
managed-block rendering, validation, and sync helpers.
```

- [ ] **Step 2: Run connector verification**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/connector-claude-code typecheck
pnpm --filter @megasaver/connector-claude-code build
pnpm verify
```

Expected: all pass; turbo includes `@megasaver/connector-claude-code`.

- [ ] **Step 3: Run built-package smoke**

Run:

```bash
node --input-type=module <<'NODE'
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncClaudeMdContext } from "./packages/connectors/claude-code/dist/index.js";

const root = await mkdtemp(join(tmpdir(), "megasaver-smoke-"));
const project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Mega Saver",
  rootPath: root,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
};
const content = await syncClaudeMdContext({
  projectRoot: root,
  context: { project, session: null, memoryEntries: [] },
});
console.log(content.includes("Mega Saver Context"));
console.log((await readFile(join(root, "CLAUDE.md"), "utf8")) === content);
await rm(root, { recursive: true, force: true });
NODE
```

Expected output:

```text
true
true
```

- [ ] **Step 4: Commit**

```bash
git add .changeset/claude-code-connector.md
git commit -m "chore(connector): add claude code changeset"
```

---

### Task 7: Wiki Evidence

**Files:**
- Modify: `wiki/entities/connectors-claude-code.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Update connector wiki page**

Update frontmatter status to `implemented`. In the body, replace planned wording with concrete implementation facts:

```md
## Public surface

- `CLAUDE_CODE_AGENT_ID`
- `CLAUDE_MD_FILE`
- `MEGA_SAVER_BLOCK_START`
- `MEGA_SAVER_BLOCK_END`
- `ClaudeCodeConnectorError`
- `ClaudeCodeContextSchema`
- `assertClaudeCodeContext(input)`
- `renderClaudeCodeContext(context)`
- `parseClaudeMd(content)`
- `upsertMegaSaverBlock({ existingContent, context })`
- `removeMegaSaverBlock(content)`
- `readClaudeMd(projectRoot)`
- `writeClaudeMd({ projectRoot, content })`
- `syncClaudeMdContext({ projectRoot, context })`
```

- [ ] **Step 2: Update index status**

Set the status paragraph to:

```md
Claude Code connector implemented on `codex/connectors-claude-code`;
review gate pending. CLI project CRUD merged. Bootstrap, project
skeleton, `@megasaver/shared`, `@megasaver/core`, and
`@megasaver/cli` are all on `origin/main` via PR #5.
```

- [ ] **Step 3: Append wiki log evidence**

Append:

```md
## [2026-05-06] schema | claude-code connector implemented

Implemented `@megasaver/connector-claude-code` on
`codex/connectors-claude-code`: package scaffold, typed connector
errors, strict `ClaudeCodeContextSchema`, deterministic managed block
rendering, exact-sentinel parser, upsert/remove helpers, and narrow
root `CLAUDE.md` filesystem sync helpers. Evidence before review:
connector test/typecheck/build passed, `pnpm verify` passed, and
built-package smoke printed `true` / `true` for context sync and file
write verification.
```

- [ ] **Step 4: Run wiki lint and full verify**

Run:

```bash
pnpm lint
pnpm verify
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add wiki/entities/connectors-claude-code.md wiki/index.md wiki/log.md
git commit -m "docs(wiki): record claude connector"
```

---

### Task 8: External Review and Final Gate

**Files:**
- Modify only files required by reviewer findings.

- [ ] **Step 1: Request production review**

Dispatch a fresh reviewer with:

```text
Review branch codex/connectors-claude-code against
docs/superpowers/specs/2026-05-06-claude-code-connector-design.md.
Focus on correctness, data loss risk in CLAUDE.md updates, core boundary
leaks, public API drift, and missing tests. Report Critical/Important/Minor
findings with exact file paths and line numbers.
```

Expected: reviewer either approves or lists findings.

- [ ] **Step 2: Request critic review**

Dispatch a fresh critic with:

```text
Adversarially review branch codex/connectors-claude-code against the spec.
Try to break the CLAUDE.md parser/updater, filesystem assumptions, context
validation, and token-discipline boundary. Report concrete findings only.
```

Expected: critic either approves or lists findings.

- [ ] **Step 3: Fix findings with TDD**

For each accepted finding:

1. Write a failing test that reproduces it.
2. Run the focused test and confirm failure.
3. Implement the smallest fix.
4. Run the focused test, connector test suite, and `pnpm verify`.
5. Commit with a caveman conventional message such as:

```bash
git commit -m "fix(connector): preserve claude md suffix"
```

- [ ] **Step 4: Re-run reviews until approved**

Do not proceed while either reviewer has open Critical or Important findings.

- [ ] **Step 5: Final verification**

Run:

```bash
pnpm --filter @megasaver/connector-claude-code test
pnpm --filter @megasaver/connector-claude-code typecheck
pnpm --filter @megasaver/connector-claude-code build
pnpm verify
```

Expected: PASS.

- [ ] **Step 6: Update final wiki review status**

Append:

```md
## [2026-05-06] schema | claude-code connector review passed

External review gate passed for `codex/connectors-claude-code`.
Production reviewer and critic both approved after fixes. Final evidence:
connector test/typecheck/build passed and `pnpm verify` passed.
```

Commit:

```bash
git add wiki/entities/connectors-claude-code.md wiki/index.md wiki/log.md
git commit -m "docs(wiki): record claude review"
```

---

## Plan Self-Review

- Spec coverage: Tasks 1-5 implement package layout, public API, context validation, markdown behavior, and filesystem behavior. Tasks 6-8 cover changeset, smoke, wiki, verification, and review gates.
- Completeness scan: each implementation step includes concrete files, commands, and expected results.
- Type consistency: public names match the spec: `ClaudeCodeContextSchema`, `ClaudeMdDocument`, `renderClaudeCodeContext`, `parseClaudeMd`, `upsertMegaSaverBlock`, `removeMegaSaverBlock`, `readClaudeMd`, `writeClaudeMd`, and `syncClaudeMdContext`.
