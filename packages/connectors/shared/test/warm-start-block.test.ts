import { describe, expect, it } from "vitest";
import { MEGA_SAVER_WS_BLOCK_END, MEGA_SAVER_WS_BLOCK_START } from "../src/constants.js";
import { upsertBlock } from "../src/upsert.js";
import { renderWarmStartBlockText } from "../src/warm-start-block.js";
import { buildContext } from "./fixtures.js";

const FIELDS = {
  briefText: "# Warm Start — demo\n- [decision] use pnpm",
  asOf: "2026-07-12T10:00:00.000Z",
};

describe("renderWarmStartBlockText", () => {
  it("wraps the brief in WS sentinels with an as-of refresh line", () => {
    const block = renderWarmStartBlockText(FIELDS);
    expect(block.startsWith(MEGA_SAVER_WS_BLOCK_START)).toBe(true);
    expect(block).toContain("use pnpm");
    expect(block).toContain(
      'As of: 2026-07-12T10:00:00.000Z — run "mega warmup --write" to refresh',
    );
    expect(block.trimEnd().endsWith(MEGA_SAVER_WS_BLOCK_END)).toBe(true);
  });

  it("rejects brief text containing any Mega Saver sentinel", () => {
    expect(() =>
      renderWarmStartBlockText({ ...FIELDS, briefText: `x\n${MEGA_SAVER_WS_BLOCK_END}\ny` }),
    ).toThrow();
    expect(() =>
      renderWarmStartBlockText({ ...FIELDS, briefText: "<!-- MEGA SAVER:BEGIN -->" }),
    ).toThrow();
  });
});

describe("upsertBlock warmStartBlock pass", () => {
  it("inserts, then replaces in place (idempotent, single pair)", () => {
    const block1 = renderWarmStartBlockText(FIELDS);
    const first = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({}),
      warmStartBlock: block1,
    });
    const block2 = renderWarmStartBlockText({ ...FIELDS, briefText: "# Warm Start — v2" });
    const second = upsertBlock({
      existingContent: first,
      context: buildContext({}),
      warmStartBlock: block2,
    });
    expect(second).toContain("Warm Start — v2");
    expect(second).not.toContain("use pnpm");
    expect(second.split(MEGA_SAVER_WS_BLOCK_START).length - 1).toBe(1);
    expect(second).toContain("intro");
  });

  it("leaves an existing WS block untouched when warmStartBlock is undefined", () => {
    const withBlock = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({}),
      warmStartBlock: renderWarmStartBlockText(FIELDS),
    });
    const resynced = upsertBlock({ existingContent: withBlock, context: buildContext({}) });
    expect(resynced).toContain("use pnpm");
  });

  it("empty-string warmStartBlock removes the block", () => {
    const withBlock = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({}),
      warmStartBlock: renderWarmStartBlockText(FIELDS),
    });
    const removed = upsertBlock({
      existingContent: withBlock,
      context: buildContext({}),
      warmStartBlock: "",
    });
    expect(removed).not.toContain("use pnpm");
    expect(removed).toContain("intro");
  });
});
