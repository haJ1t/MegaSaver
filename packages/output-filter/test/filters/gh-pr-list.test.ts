import { describe, expect, it } from "vitest";
import { compressGhPrList } from "../../src/filters/gh-pr-list.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "gh-pr-list");
if (filter === undefined) throw new Error("gh-pr-list not registered");

const LIST = Array.from(
  { length: 34 },
  (_, i) => `${100 + i}\tfix: flaky retry in saver ${i}\tfix/flaky-${i}\tOPEN\t2026-08-0${(i % 6) + 1}T10:00:00Z`,
).join("\n");

describe("gh-pr-list filter", () => {
  it("caps the TSV listing and counts the fold", () => {
    const out = assertFilterConformance(filter, LIST);
    expect(out).toContain("100\tfix: flaky retry in saver 0");
    expect(out).toContain("129\tfix: flaky retry in saver 29");
    expect(out).not.toContain("130\tfix: flaky retry in saver 30");
    expect(out).toContain("… [4 more PRs]");
  });

  it("passes non-TSV output through verbatim", () => {
    expect(compressGhPrList("no pull requests match your search")).toBe(
      "no pull requests match your search",
    );
  });
});
