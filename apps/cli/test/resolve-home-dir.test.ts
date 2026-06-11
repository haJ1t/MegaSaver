import { describe, expect, it } from "vitest";
import { resolveHomeDir } from "../src/store.js";

describe("resolveHomeDir", () => {
  it("uses HOME when set", () => {
    expect(resolveHomeDir({ HOME: "/home/u", USERPROFILE: "C:\\Users\\u" })).toBe("/home/u");
  });

  it("falls back to USERPROFILE when HOME is unset (Windows)", () => {
    expect(resolveHomeDir({ USERPROFILE: "C:\\Users\\u" })).toBe("C:\\Users\\u");
  });

  it("returns '' when neither HOME nor USERPROFILE is set", () => {
    expect(resolveHomeDir({})).toBe("");
  });
});
