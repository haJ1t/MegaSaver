import { describe, expect, it } from "vitest";
import { searchDejaVu } from "../../src/deja-vu/corpus.js";

describe("deja-vu", () => {
  it("finds exact", () => {
    const corpus = [{ id: "1", text: "auth timeout", workspaceKey: "wk1" }];
    expect(searchDejaVu(corpus, "auth timeout")[0]?.id).toBe("1");
  });
});
