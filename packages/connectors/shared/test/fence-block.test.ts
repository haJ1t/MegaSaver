import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_FENCE_BLOCK_END,
  MEGA_SAVER_FENCE_BLOCK_START,
} from "../src/constants.js";
import { renderFenceBlockText } from "../src/fence-block.js";
import { upsertBlock } from "../src/upsert.js";
import { buildContext } from "./fixtures.js";

const ENTRIES = [
  {
    path: "pnpm-lock.yaml",
    class: "lockfile",
    alternative: "run `pnpm install` instead",
  },
  { path: "dist/**", class: "build-output", mode: "deny" as const },
];

describe("renderFenceBlockText", () => {
  it("wraps entries in FENCE sentinels with alternatives and the override hint", () => {
    const block = renderFenceBlockText({ entries: ENTRIES });
    expect(block.startsWith(MEGA_SAVER_FENCE_BLOCK_START)).toBe(true);
    expect(block).toContain("`pnpm-lock.yaml` (lockfile)");
    expect(block).toContain("pnpm install");
    expect(block).toContain("DENY");
    expect(block).toContain("mega fence allow");
    expect(block.trimEnd().endsWith(MEGA_SAVER_FENCE_BLOCK_END)).toBe(true);
  });
  it("caps the listing at 20 entries", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      path: `gen/${i}.ts`,
      class: "codegen-header",
    }));
    const block = renderFenceBlockText({ entries: many });
    expect(block).toContain("gen/19.ts");
    expect(block).not.toContain("gen/20.ts");
    expect(block).toContain("and 3 more — see fence.yaml");
  });
  it("rejects sentinel-containing input", () => {
    expect(() =>
      renderFenceBlockText({
        entries: [
          { path: MEGA_SAVER_FENCE_BLOCK_END, class: "vendored" },
        ],
      }),
    ).toThrow();
  });
});

describe("upsertBlock fenceBlock pass", () => {
  it("inserts, replaces in place, leaves untouched on undefined, removes on empty", () => {
    const first = upsertBlock({
      existingContent: "intro\n",
      context: buildContext({}),
      fenceBlock: renderFenceBlockText({ entries: ENTRIES }),
    });
    expect(first).toContain("pnpm-lock.yaml");
    const untouched = upsertBlock({
      existingContent: first,
      context: buildContext({}),
    });
    expect(untouched).toContain("pnpm-lock.yaml");
    const replaced = upsertBlock({
      existingContent: first,
      context: buildContext({}),
      fenceBlock: renderFenceBlockText({ entries: [ENTRIES[1]!] }),
    });
    expect(replaced).not.toContain("pnpm-lock.yaml");
    expect(replaced.split(MEGA_SAVER_FENCE_BLOCK_START).length - 1).toBe(1);
    const removed = upsertBlock({
      existingContent: first,
      context: buildContext({}),
      fenceBlock: "",
    });
    expect(removed).not.toContain(MEGA_SAVER_FENCE_BLOCK_START);
    expect(removed).toContain("intro");
  });
});
