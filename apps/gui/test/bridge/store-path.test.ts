import { join } from "node:path";
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
  it("win32 uses localAppData", () => {
    expect(
      resolveBridgeStorePath({
        storeOverride: undefined,
        home: "C:\\Users\\u",
        xdgDataHome: undefined,
        platform: "win32",
        localAppData: "C:\\Users\\u\\AppData\\Local",
      }),
    ).toBe(join("C:\\Users\\u\\AppData\\Local", "megasaver"));
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
