import { constants } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  secureDirectoryOpenFlags,
  secureOpenFlags,
  syncDirectoryAnchor,
} from "../src/lm2-secure-fs.js";

describe("LM2 portable filesystem guards", () => {
  it("omits unsupported POSIX open flags on Windows", () => {
    expect(secureOpenFlags(constants.O_RDONLY, "win32")).toBe(constants.O_RDONLY);
    expect(secureOpenFlags(constants.O_RDONLY, "linux")).toBe(
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    expect(secureDirectoryOpenFlags("win32")).toBe(constants.O_RDONLY);
    expect(secureDirectoryOpenFlags("linux")).toBe(
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  });

  it("does not fsync a directory descriptor on Windows", () => {
    expect(() =>
      syncDirectoryAnchor({ chain: [{ descriptor: -1 }] } as never, "win32"),
    ).not.toThrow();
  });
});
