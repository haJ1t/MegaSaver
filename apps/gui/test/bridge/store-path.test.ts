import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBridgeStorePath } from "../../bridge/store-path.js";

describe("resolveBridgeStorePath", () => {
  it("override is returned resolved", () => {
    expect(
      resolveBridgeStorePath({
        storeOverride: "/abs/x",
        home: "/h",
        xdgDataHome: undefined,
        platform: "linux",
        localAppData: undefined,
      }),
    ).toBe("/abs/x");
  });
  it("posix default", () => {
    expect(
      resolveBridgeStorePath({
        storeOverride: undefined,
        home: "/home/u",
        xdgDataHome: undefined,
        platform: "linux",
        localAppData: undefined,
      }),
    ).toBe(join("/home/u", ".local", "share", "megasaver"));
  });
  // win32 cases assert BRANCH SELECTION on a posix test host (node:path uses
  // posix separators); the real backslash output is proven by windows-latest CI.
  it("win32 uses localAppData, not the home fallback or posix default", () => {
    const out = resolveBridgeStorePath({
      storeOverride: undefined,
      home: "C:\\Users\\u",
      xdgDataHome: undefined,
      platform: "win32",
      localAppData: "C:\\Users\\u\\AppData\\Local",
    });
    expect(out).toBe(resolve("C:\\Users\\u\\AppData\\Local", "megasaver"));
    expect(out).not.toBe(resolve("C:\\Users\\u", "AppData", "Local", "megasaver"));
  });
  it("win32 falls back to home/AppData/Local when localAppData unset", () => {
    const out = resolveBridgeStorePath({
      storeOverride: undefined,
      home: "C:\\Users\\u",
      xdgDataHome: undefined,
      platform: "win32",
      localAppData: undefined,
    });
    expect(out).toBe(resolve("C:\\Users\\u", "AppData", "Local", "megasaver"));
  });
  it("win32 throws when localAppData and home are both empty", () => {
    expect(() =>
      resolveBridgeStorePath({
        storeOverride: undefined,
        home: undefined,
        xdgDataHome: undefined,
        platform: "win32",
        localAppData: undefined,
      }),
    ).toThrow();
  });
  it("throws when no home and no override/xdg", () => {
    expect(() =>
      resolveBridgeStorePath({
        storeOverride: undefined,
        home: undefined,
        xdgDataHome: undefined,
        platform: "linux",
        localAppData: undefined,
      }),
    ).toThrow();
  });
});
