import { describe, expect, it } from "vitest";
import { compressGitLog } from "../../src/filters/git-log.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "git-log");
if (filter === undefined) throw new Error("git-log not registered");

const sha = (i: number): string => (0x1abc000 + i * 7919).toString(16).padStart(7, "0");
const LOG = Array.from({ length: 30 }, (_, i) => `${sha(i)} feat(core): change number ${i}`).join(
  "\n",
);

describe("git-log filter", () => {
  it("collapses the middle of a long oneline log, keeps head and tail", () => {
    const out = assertFilterConformance(filter, LOG);
    expect(out).toContain(`${sha(0)} feat(core): change number 0`);
    expect(out).toContain(`${sha(14)} feat(core): change number 14`);
    expect(out).toContain("… [10 commits omitted]");
    expect(out).toContain(`${sha(29)} feat(core): change number 29`);
    expect(out).not.toContain("change number 17");
  });

  it("passes full-format logs through verbatim (shape guard)", () => {
    const full = ["commit 1abc0000", "Author: Dev <dev@example.invalid>", "", "    subject"].join(
      "\n",
    );
    expect(compressGitLog(full)).toBe(full);
  });
});
