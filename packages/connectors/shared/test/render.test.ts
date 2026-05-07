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

  it("renders multi-line memory entries with continuation indent", () => {
    const block = renderBlock(
      buildContext({
        memoryEntries: [{ id: MEMORY_ID, scope: "project", content: "line1\nline2" }],
      }),
    );
    expect(block).toContain(`- [project:${MEMORY_ID}] line1\n  line2`);
  });
});
