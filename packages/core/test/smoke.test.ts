import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("@megasaver/core barrel", () => {
  it("loads without throwing", () => {
    expect(core).toBeDefined();
  });
});
