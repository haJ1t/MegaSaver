import { describe, expect, it } from "vitest";
import { searchDejaVu } from "../../src/deja-vu/corpus.js";

describe("deja-vu", () => {
  it("exact match outranks partial", () => {
    const corpus = [
      { id: "1", text: "auth timeout", workspaceKey: "wk1" },
      { id: "2", text: "other", workspaceKey: "wk1" },
    ];
    const res = searchDejaVu(corpus, "auth timeout");
    expect(res[0]?.id).toBe("1");
  });

  it("empty query no match", () => {
    const corpus = [{ id: "1", text: "hello", workspaceKey: "wk1" }];
    expect(searchDejaVu(corpus, "xyz")).toHaveLength(0);
  });
});
