import { describe, expect, expectTypeOf, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  parseClaudeMd,
  removeMegaSaverBlock,
  renderClaudeCodeContext,
  upsertMegaSaverBlock,
} from "../src/index.js";
import type { ClaudeCodeContext } from "../src/index.js";
import { project, projectMemory, session, sessionMemory } from "./fixtures.js";

const context = {
  project,
  session,
  memoryEntries: [projectMemory, sessionMemory],
};

function expectBlockConflict(action: () => unknown): void {
  expect(action).toThrow(ClaudeCodeConnectorError);
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeCodeConnectorError);
    expect((error as ClaudeCodeConnectorError).code).toBe("claude_md_block_conflict");
  }
}

describe("renderClaudeCodeContext", () => {
  test("requires typed Claude Code context inputs", () => {
    expectTypeOf(renderClaudeCodeContext).parameter(0).toEqualTypeOf<ClaudeCodeContext>();
    expectTypeOf(upsertMegaSaverBlock).parameter(0).toEqualTypeOf<{
      existingContent: string;
      context: ClaudeCodeContext;
    }>();

    const assertInvalidInputsAreRejected = (): void => {
      // @ts-expect-error Missing session and memoryEntries must be rejected at compile time.
      renderClaudeCodeContext({ project });
      upsertMegaSaverBlock({
        existingContent: "",
        // @ts-expect-error Missing session and memoryEntries must be rejected at compile time.
        context: { project },
      });
    };

    expect(assertInvalidInputsAreRejected).toBeTypeOf("function");
  });

  test("renders only the managed block with context metadata and memory", () => {
    expect(renderClaudeCodeContext(context)).toBe(
      `${MEGA_SAVER_BLOCK_START}
# Mega Saver Context

Agent: claude-code
Project: Mega Saver (${project.id})
Session: Connector implementation
Risk: medium

## Memory

- [project:${projectMemory.id}] Project-level convention for Claude Code.
- [session:${sessionMemory.id}] Session-specific context for Claude Code.
${MEGA_SAVER_BLOCK_END}
`,
    );
  });

  test("renders none for absent session metadata and empty memory", () => {
    expect(
      renderClaudeCodeContext({
        project,
        session: null,
        memoryEntries: [],
      }),
    ).toContain("Session: none\nRisk: none\n\n## Memory\n\n- none\n");
  });

  test("indents multiline memory continuation lines", () => {
    expect(
      renderClaudeCodeContext({
        project,
        session,
        memoryEntries: [
          {
            ...projectMemory,
            content: "first line\nsecond line\nthird line",
          },
        ],
      }),
    ).toContain(
      `- [project:${projectMemory.id}] first line
  second line
  third line
`,
    );
  });
});

describe("parseClaudeMd", () => {
  test("returns no block for human-only content", () => {
    expect(parseClaudeMd("# Human Notes\n")).toEqual({
      hasManagedBlock: false,
      contentBeforeBlock: "# Human Notes\n",
      managedBlock: null,
      contentAfterBlock: "",
    });
  });

  test("splits exactly one complete managed block", () => {
    const block = renderClaudeCodeContext(context);
    expect(parseClaudeMd(`# Human\n\n${block}\nAfter\n`)).toEqual({
      hasManagedBlock: true,
      contentBeforeBlock: "# Human\n\n",
      managedBlock: block,
      contentAfterBlock: "\nAfter\n",
    });
  });

  test("rejects multiple starts", () => {
    expectBlockConflict(() =>
      parseClaudeMd(`${MEGA_SAVER_BLOCK_START}\n${MEGA_SAVER_BLOCK_START}\n`),
    );
  });

  test("rejects multiple ends", () => {
    expectBlockConflict(() =>
      parseClaudeMd(
        `${MEGA_SAVER_BLOCK_START}\n${MEGA_SAVER_BLOCK_END}\n${MEGA_SAVER_BLOCK_END}\n`,
      ),
    );
  });

  test("rejects unclosed blocks", () => {
    expectBlockConflict(() => parseClaudeMd(`${MEGA_SAVER_BLOCK_START}\nbody\n`));
  });

  test("rejects end-before-start", () => {
    expectBlockConflict(() =>
      parseClaudeMd(`${MEGA_SAVER_BLOCK_END}\nbody\n${MEGA_SAVER_BLOCK_START}\n`),
    );
  });
});

describe("upsertMegaSaverBlock", () => {
  test("appends a managed block after human content with one blank line", () => {
    const block = renderClaudeCodeContext(context);
    expect(upsertMegaSaverBlock({ existingContent: "# Human\n", context })).toBe(
      `# Human\n\n${block}`,
    );
  });

  test("replaces an existing valid managed block", () => {
    const oldBlock = renderClaudeCodeContext({ project, session, memoryEntries: [] });
    const newBlock = renderClaudeCodeContext(context);

    expect(
      upsertMegaSaverBlock({
        existingContent: `# Human\n\n${oldBlock}`,
        context,
      }),
    ).toBe(`# Human\n\n${newBlock}`);
  });

  test("normalizes blank lines when replacing an adjacent managed block", () => {
    const oldBlock = renderClaudeCodeContext({ project, session, memoryEntries: [] });
    const newBlock = renderClaudeCodeContext(context);

    expect(
      upsertMegaSaverBlock({
        existingContent: `# Human\n${oldBlock}After\n`,
        context,
      }),
    ).toBe(`# Human\n\n${newBlock}\nAfter\n`);
  });
});

describe("removeMegaSaverBlock", () => {
  test("removes a managed block and preserves human content with one trailing newline", () => {
    const block = renderClaudeCodeContext(context);
    expect(removeMegaSaverBlock(`# Human\n\n${block}\nAfter\n`)).toBe("# Human\n\nAfter\n");
  });

  test("returns an empty string when only the managed block remains", () => {
    expect(removeMegaSaverBlock(renderClaudeCodeContext(context))).toBe("");
  });
});
