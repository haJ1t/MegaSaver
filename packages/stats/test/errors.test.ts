import { describe, expect, it } from "vitest";
import { StatsError, statsErrorCodeSchema } from "../src/errors.js";

describe("StatsError", () => {
  it("sets name and code", () => {
    const err = new StatsError("write_failed");
    expect(err.name).toBe("StatsError");
    expect(err.code).toBe("write_failed");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults the message to the code", () => {
    expect(new StatsError("schema_invalid").message).toBe("schema_invalid");
  });

  it("uses a provided message", () => {
    expect(new StatsError("store_corrupt", "bad line").message).toBe("bad line");
  });
});

describe("statsErrorCodeSchema", () => {
  it("has exactly the locked alphabetic options", () => {
    expect(statsErrorCodeSchema.options).toEqual([
      "schema_invalid",
      "store_corrupt",
      "write_failed",
    ]);
  });

  it("rejects an unknown code", () => {
    expect(statsErrorCodeSchema.safeParse("boom").success).toBe(false);
  });
});
