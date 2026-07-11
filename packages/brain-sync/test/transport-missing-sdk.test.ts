import { describe, expect, it } from "vitest";
import { BrainSyncError } from "../src/errors.js";
import { rethrowSdkLoadError } from "../src/transport.js";

// @aws-sdk/client-s3 is externalized from the standalone `mega.mjs` bundle, so a
// bare `node mega.mjs` download can lack it. A missing dynamic import rejects with
// err.code ERR_MODULE_NOT_FOUND (Node ESM) / MODULE_NOT_FOUND (CJS); createTransport
// must convert that into a friendly transport_error and pass every other error through.
describe("rethrowSdkLoadError", () => {
  for (const code of ["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"] as const) {
    it(`maps ${code} to a transport_error naming the missing package`, () => {
      const missing = Object.assign(new Error("Cannot find package '@aws-sdk/client-s3'"), {
        code,
      });
      try {
        rethrowSdkLoadError(missing);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BrainSyncError);
        expect((err as BrainSyncError).code).toBe("transport_error");
        expect((err as Error).message).toContain("@aws-sdk/client-s3 package is required");
      }
    });
  }

  it("rethrows unrelated errors unchanged", () => {
    const other = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    expect(() => rethrowSdkLoadError(other)).toThrow("connection reset");
    expect(() => rethrowSdkLoadError(other)).not.toThrow(BrainSyncError);
  });
});
