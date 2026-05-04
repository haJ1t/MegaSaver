import { describe, expect, it } from "vitest";
import * as shared from "../src/index.js";

describe("@megasaver/shared barrel", () => {
  it("loads without throwing", () => {
    expect(shared).toBeDefined();
  });
});
