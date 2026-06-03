import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
} from "../src/constants.js";
import { renderContextGateBlock } from "../src/context-gate-block.js";
import { buildContext } from "./fixtures.js";

const enabledTokenSaver = {
  enabled: true,
  mode: "balanced" as const,
  maxReturnedBytes: 12_000,
  storeRawOutput: true,
  redactSecrets: true,
  autoRepair: true,
  createdAt: "2026-05-07T12:00:00.000Z",
  updatedAt: "2026-05-07T12:00:00.000Z",
};

function ctxWithTokenSaver(tokenSaver: unknown) {
  const base = buildContext({ withSession: true });
  return { ...base, session: { ...base.session, tokenSaver } };
}

describe("renderContextGateBlock", () => {
  it("returns empty string when there is no session", () => {
    expect(renderContextGateBlock(buildContext())).toBe("");
  });

  it("returns empty string when tokenSaver is absent", () => {
    expect(renderContextGateBlock(buildContext({ withSession: true }))).toBe("");
  });

  it("returns empty string when tokenSaver.enabled is false", () => {
    expect(renderContextGateBlock(ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false }))).toBe(
      "",
    );
  });

  it("renders the block when enabled, with both sentinels", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    expect(block.startsWith(MEGA_SAVER_CG_BLOCK_START)).toBe(true);
    expect(block).toContain(MEGA_SAVER_CG_BLOCK_END);
    expect(block.endsWith("\n")).toBe(true);
  });

  it("substitutes session id, project id, mode and maxReturnedBytes", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    expect(block).toContain("Session: 22222222-2222-4222-8222-222222222222");
    expect(block).toContain("Project: 11111111-1111-4111-8111-111111111111");
    expect(block).toContain("Mode: balanced");
    expect(block).toContain("Max returned bytes: 12000");
  });

  it("mentions the four MCP tools and the intent rule", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    for (const tool of ["mega_read_file", "mega_run_command", "mega_fetch_chunk", "mega_recall"]) {
      expect(block).toContain(tool);
    }
    expect(block).toContain("Always pass `intent`");
  });
});
