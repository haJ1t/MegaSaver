import { describe, expect, it } from "vitest";
import { SkillPackError } from "../src/errors.js";
import { loadPack } from "../src/load-pack.js";

describe("loadPack — v0.3 placeholder surface", () => {
  it("rejects with SkillPackError(not_implemented) for a valid path", async () => {
    await expect(loadPack("/path/to/pack")).rejects.toMatchObject({
      name: "SkillPackError",
      code: "not_implemented",
      packPath: "/path/to/pack",
    });
  });

  it("rejects with SkillPackError instance", async () => {
    await expect(loadPack("/x")).rejects.toBeInstanceOf(SkillPackError);
  });

  it("rejects an empty path at the boundary", () => {
    expect(() => loadPack("")).toThrow();
  });
});
