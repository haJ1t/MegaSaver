import { describe, expect, it } from "vitest";
import { MEGA_SAVER_HANDOFF_BLOCK_END, MEGA_SAVER_HANDOFF_BLOCK_START } from "../src/constants.js";
import { containsSentinel } from "../src/sentinel-guard.js";
import { upsertHandoffBlockText } from "../src/upsert.js";

const HB = MEGA_SAVER_HANDOFF_BLOCK_START;
const HE = MEGA_SAVER_HANDOFF_BLOCK_END;

const BLOCK = `${HB}\nhandoff body\n${HE}\n`;

const OTHERS = [
  "# Notes",
  "",
  "<!-- MEGA SAVER:BEGIN -->",
  "legacy body",
  "<!-- MEGA SAVER:END -->",
  "",
  "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->",
  "gate body",
  "<!-- MEGA SAVER:CONTEXT_GATE END -->",
  "",
  "<!-- MEGA SAVER:WARM_START BEGIN -->",
  "warm body",
  "<!-- MEGA SAVER:WARM_START END -->",
  "",
].join("\n");

describe("HANDOFF sentinel pair", () => {
  it("uses the HANDOFF HTML comment sentinels", () => {
    expect(HB).toBe("<!-- MEGA SAVER:HANDOFF BEGIN -->");
    expect(HE).toBe("<!-- MEGA SAVER:HANDOFF END -->");
  });

  it("is registered in the sentinel guard", () => {
    expect(containsSentinel(`x\n${HB}\ny`)).toBe(true);
    expect(containsSentinel(`x\n${HE}\ny`)).toBe(true);
    expect(containsSentinel("<!-- MEGA SAVER:HANDOFF​ END -->")).toBe(true);
  });
});

describe("upsertHandoffBlockText", () => {
  it("appends the block after existing blocks, others byte-identical", () => {
    const out = upsertHandoffBlockText(OTHERS, BLOCK);
    expect(out).toBe(`${OTHERS}\n${BLOCK}`);
  });

  it("is idempotent — applying twice yields identical output", () => {
    const once = upsertHandoffBlockText("# My notes\n", BLOCK);
    const twice = upsertHandoffBlockText(once, BLOCK);
    expect(twice).toBe(once);
  });

  it("replaces an existing HANDOFF block in place (single pair)", () => {
    const first = upsertHandoffBlockText("intro\n", BLOCK);
    const replaced = upsertHandoffBlockText(first, `${HB}\nsecond body\n${HE}\n`);
    expect(replaced).toContain("second body");
    expect(replaced).not.toContain("handoff body");
    expect(replaced.split(HB).length - 1).toBe(1);
    expect(replaced).toContain("intro");
  });

  it("empty block removes the HANDOFF block and restores content exactly", () => {
    const withBlock = upsertHandoffBlockText(OTHERS, BLOCK);
    expect(upsertHandoffBlockText(withBlock, "")).toBe(OTHERS);
  });

  it("empty block on content without a HANDOFF block is a no-op", () => {
    expect(upsertHandoffBlockText("# Notes\n", "")).toBe("# Notes\n");
  });

  it("preserves CRLF line endings (dominant-EOL round-trip)", () => {
    const out = upsertHandoffBlockText("# Notes\r\n\r\nhello\r\n", BLOCK);
    expect(out.includes("\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });
});
