import { describe, expect, it } from "vitest";
import { LauncherError, launcherErrorCodeSchema } from "../src/launcher.js";

describe("LauncherError", () => {
  it("carries a typed code and name", () => {
    const err = new LauncherError("invalid_session_config", "bad config");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("LauncherError");
    expect(err.code).toBe("invalid_session_config");
    expect(err.message).toBe("bad config");
  });

  it("enumerates its codes", () => {
    expect(launcherErrorCodeSchema.options).toEqual(["invalid_session_config"]);
  });
});
