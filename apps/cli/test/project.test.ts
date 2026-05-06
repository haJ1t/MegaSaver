import { describe, expect, it } from "vitest";
import { formatProjectLine } from "../src/commands/project.js";

describe("formatProjectLine", () => {
  it("renders id and name separated by exactly two spaces", () => {
    expect(
      formatProjectLine({
        id: "01HXYZ-aaaa-bbbb-cccc-dddddddddddd",
        name: "demo",
      }),
    ).toBe("01HXYZ-aaaa-bbbb-cccc-dddddddddddd  demo");
  });

  it("preserves whitespace inside name without quoting", () => {
    expect(
      formatProjectLine({
        id: "id1",
        name: "two words",
      }),
    ).toBe("id1  two words");
  });
});
