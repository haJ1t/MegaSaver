import { describe, expect, it } from "vitest";
import { resolveGuiAuthToken, resolveGuiToken } from "../../bridge/server.js";

describe("resolveGuiToken", () => {
  it("returns the env token when MEGASAVER_GUI_TOKEN is set", () => {
    expect(resolveGuiToken({ MEGASAVER_GUI_TOKEN: "dev-shared-token" })).toBe("dev-shared-token");
  });

  it("generates a random token (>=32 chars) when the env is absent", () => {
    const token = resolveGuiToken({});
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("treats an empty env token as absent and generates one", () => {
    const token = resolveGuiToken({ MEGASAVER_GUI_TOKEN: "" });
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("generates a distinct token on each call when the env is absent", () => {
    expect(resolveGuiToken({})).not.toBe(resolveGuiToken({}));
  });
});

describe("resolveGuiAuthToken (dev-relax wall control)", () => {
  it("returns undefined (wall off) when MEGASAVER_GUI_DEV=1", () => {
    expect(resolveGuiAuthToken({ MEGASAVER_GUI_DEV: "1" })).toBeUndefined();
  });

  it("returns a token (wall on) when MEGASAVER_GUI_DEV is absent", () => {
    const token = resolveGuiAuthToken({});
    expect(token).toBeDefined();
    expect((token as string).length).toBeGreaterThanOrEqual(32);
  });

  it("honours an explicit MEGASAVER_GUI_TOKEN when not in dev-relax", () => {
    expect(resolveGuiAuthToken({ MEGASAVER_GUI_TOKEN: "shared" })).toBe("shared");
  });
});
