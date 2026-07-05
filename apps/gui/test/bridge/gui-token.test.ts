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

describe("resolveGuiAuthToken (wall is ALWAYS on)", () => {
  it("always returns a token — no env disables the wall", () => {
    // The retired MEGASAVER_GUI_DEV=1 escape hatch must not resurrect: even
    // with it set, a real token is returned so the /api wall stays armed.
    const token = resolveGuiAuthToken({ MEGASAVER_GUI_DEV: "1" });
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("returns a token when the env is empty", () => {
    const token = resolveGuiAuthToken({});
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("honours an explicit MEGASAVER_GUI_TOKEN", () => {
    expect(resolveGuiAuthToken({ MEGASAVER_GUI_TOKEN: "shared-dev-token-value-000000000000" })).toBe(
      "shared-dev-token-value-000000000000",
    );
  });
});
