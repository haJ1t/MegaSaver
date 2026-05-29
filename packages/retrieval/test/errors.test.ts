import { describe, expect, it } from "vitest";
import { RetrievalError, retrievalErrorCodeSchema } from "../src/errors.js";

describe("RetrievalError", () => {
  it("sets name and code", () => {
    const err = new RetrievalError("invalid_input");
    expect(err.name).toBe("RetrievalError");
    expect(err.code).toBe("invalid_input");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults the message to the code", () => {
    const err = new RetrievalError("invalid_input");
    expect(err.message).toBe("invalid_input");
  });

  it("uses a provided message", () => {
    const err = new RetrievalError("invalid_input", "topN must be positive");
    expect(err.message).toBe("topN must be positive");
  });
});

describe("retrievalErrorCodeSchema", () => {
  it("has exactly the locked alphabetic options", () => {
    expect(retrievalErrorCodeSchema.options).toEqual(["invalid_input"]);
  });

  it("rejects an unknown code", () => {
    expect(retrievalErrorCodeSchema.safeParse("boom").success).toBe(false);
  });
});
