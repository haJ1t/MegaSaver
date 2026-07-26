import { constants } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hasRequiredMode,
  losslessFileIdentity,
  secureDirectoryOpenFlags,
  secureOpenFlags,
  syncDirectoryAnchor,
  syncDirectoryDescriptor,
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
    expect(() => syncDirectoryDescriptor(-1, "win32")).not.toThrow();
  });

  it("requires exact POSIX modes only where the platform supports them", () => {
    expect(hasRequiredMode(0o777, 0o700, "win32")).toBe(true);
    expect(hasRequiredMode(0o777, 0o700, "linux")).toBe(false);
    expect(hasRequiredMode(0o700, 0o700, "linux")).toBe(true);
  });

  it("preserves filesystem identity beyond JavaScript number precision", () => {
    expect(
      losslessFileIdentity({
        dev: 9_007_199_254_740_993n,
        ino: 18_014_398_509_481_985n,
      }),
    ).toEqual({ device: "9007199254740993", inode: "18014398509481985" });
  });
});
