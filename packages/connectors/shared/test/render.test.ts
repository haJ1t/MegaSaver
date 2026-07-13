import { describe, expect, it } from "vitest";
import { renderBlock } from "../src/render.js";
import { MEMORY_ID, buildContext } from "./fixtures.js";

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
    expect(block).toContain("Risk: medium");
  });

  it("renders memory entries", () => {
    const block = renderBlock(
      buildContext({
        memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "first" }],
      }),
    );
    expect(block).toContain(`- [project:${MEMORY_ID}] first`);
  });

  // X5 (PR #37): continuation-indent path removed. contentSchema rejects newlines
  // at the CLI boundary, so multi-line content is unreachable through the public
  // surface. Test deleted because it asserted defensive behavior on out-of-policy
  // input that the renderer no longer handles.
});

describe("changedFrom suffix", () => {
  it("renders the changed-from suffix when memoryChangedFrom has the entry", () => {
    const block = renderBlock({
      ...buildContext({
        memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "use pnpm" }],
      }),
      memoryChangedFrom: {
        [MEMORY_ID]: { title: "use npm", closedAt: "2026-07-01T00:00:00.000Z" },
      },
    });
    expect(block).toContain(
      `- [project:${MEMORY_ID}] use pnpm (changed from "use npm", closed 2026-07-01)`,
    );
  });

  it("renders no suffix for entries without a changedFrom record", () => {
    const block = renderBlock(
      buildContext({ memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "use pnpm" }] }),
    );
    expect(block).toContain(`- [project:${MEMORY_ID}] use pnpm\n`);
    expect(block).not.toContain("changed from");
  });
});
