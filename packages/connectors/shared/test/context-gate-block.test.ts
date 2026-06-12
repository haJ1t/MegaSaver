import type { TokenSaverSettings } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { MEGA_SAVER_CG_BLOCK_END, MEGA_SAVER_CG_BLOCK_START } from "../src/constants.js";
import { renderContextGateBlock } from "../src/context-gate-block.js";
import { upsertBlock } from "../src/upsert.js";
import { buildContext } from "./fixtures.js";

const enabledTokenSaver: TokenSaverSettings = {
  enabled: true,
  mode: "balanced",
  maxReturnedBytes: 12_000,
  storeRawOutput: true,
  redactSecrets: true,
  autoRepair: true,
  createdAt: "2026-05-07T12:00:00.000Z",
  updatedAt: "2026-05-07T12:00:00.000Z",
};

function ctxWithTokenSaver(tokenSaver: TokenSaverSettings) {
  return buildContext({ withSession: true, tokenSaver });
}

describe("renderContextGateBlock", () => {
  it("returns empty string when there is no session", () => {
    expect(renderContextGateBlock(buildContext())).toBe("");
  });

  it("returns empty string when tokenSaver is absent", () => {
    expect(renderContextGateBlock(buildContext({ withSession: true }))).toBe("");
  });

  it("returns empty string when tokenSaver.enabled is false", () => {
    expect(
      renderContextGateBlock(ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false })),
    ).toBe("");
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

  it("mentions the four MCP tools (proxy default naming) and the intent rule", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    for (const tool of [
      "proxy_read_file",
      "proxy_run_command",
      "proxy_expand_chunk",
      "mega_recall",
    ]) {
      expect(block).toContain(tool);
    }
    expect(block).toContain("Always pass `intent`");
  });

  it("biases to proxy tools for tests/typecheck/build/diffs and the expand rule (D8)", () => {
    const block = renderContextGateBlock(ctxWithTokenSaver(enabledTokenSaver));
    expect(block).toContain("Prefer proxy tools for reading files, searching code, running tests,");
    expect(block).toContain("Use native tools only when explicitly required.");
    expect(block).toContain("Expand chunks before assuming omitted content is irrelevant.");
  });
});

describe("upsertBlock — CONTEXT_GATE block management", () => {
  it("appends the CG block after the legacy block when enabled", () => {
    const ctx = ctxWithTokenSaver(enabledTokenSaver);
    const result = upsertBlock({ existingContent: "", context: ctx });
    expect(result).toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(result.indexOf("<!-- MEGA SAVER:BEGIN -->")).toBeLessThan(
      result.indexOf(MEGA_SAVER_CG_BLOCK_START),
    );
  });

  it("omits the CG block when disabled", () => {
    const ctx = ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false });
    const result = upsertBlock({ existingContent: "", context: ctx });
    expect(result).not.toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(result).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("removes a stale CG block when the session is now disabled", () => {
    const enabled = upsertBlock({
      existingContent: "",
      context: ctxWithTokenSaver(enabledTokenSaver),
    });
    expect(enabled).toContain(MEGA_SAVER_CG_BLOCK_START);
    const disabled = upsertBlock({
      existingContent: enabled,
      context: ctxWithTokenSaver({ ...enabledTokenSaver, enabled: false }),
    });
    expect(disabled).not.toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(disabled).toContain("<!-- MEGA SAVER:BEGIN -->");
  });

  it("re-applying an enabled upsert is byte-identical (noop predicate)", () => {
    const once = upsertBlock({
      existingContent: "",
      context: ctxWithTokenSaver(enabledTokenSaver),
    });
    const twice = upsertBlock({
      existingContent: once,
      context: ctxWithTokenSaver(enabledTokenSaver),
    });
    expect(twice).toBe(once);
  });
});
