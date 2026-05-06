import { describe, expect, it } from "vitest";
import { resolveStorePath } from "../src/store.js";

describe("resolveStorePath", () => {
  const home = "/home/user";

  it("returns absolute --store flag verbatim", () => {
    expect(
      resolveStorePath({
        storeFlag: "/abs/megasaver",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/abs/megasaver");
  });

  it("resolves a relative --store flag against cwd", () => {
    expect(
      resolveStorePath({
        storeFlag: "./local-store",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/repo/local-store");
  });

  it("rejects an empty --store flag", () => {
    expect(() =>
      resolveStorePath({
        storeFlag: "",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toThrow();
  });

  it("rejects a whitespace-only --store flag", () => {
    expect(() =>
      resolveStorePath({
        storeFlag: "   ",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toThrow();
  });

  it("uses XDG_DATA_HOME when set and non-empty", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: "/xdg/data",
      }),
    ).toBe("/xdg/data/megasaver");
  });

  it("ignores empty XDG_DATA_HOME and falls back to HOME", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: "",
      }),
    ).toBe("/home/user/.local/share/megasaver");
  });

  it("falls back to HOME when XDG_DATA_HOME is undefined", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/home/user/.local/share/megasaver");
  });

  it("flag wins even when XDG is set", () => {
    expect(
      resolveStorePath({
        storeFlag: "/abs/override",
        cwd: "/repo",
        home,
        xdgDataHome: "/xdg/data",
      }),
    ).toBe("/abs/override");
  });

  it("trims whitespace around the --store flag before resolving", () => {
    expect(
      resolveStorePath({
        storeFlag: "  /abs/with-spaces  ",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/abs/with-spaces");
  });
});
