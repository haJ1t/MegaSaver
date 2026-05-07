import { describe, expect, it } from "vitest";
import {
  ConnectorError,
  connectorErrorCodeSchema,
} from "../src/errors.js";

describe("ConnectorError", () => {
  it("enumerates the v0.1 code union", () => {
    expect(connectorErrorCodeSchema.options).toEqual([
      "context_invalid",
      "block_conflict",
      "file_read_failed",
      "file_write_failed",
      "target_path_invalid",
    ]);
  });

  it("captures code and filePath", () => {
    const err = new ConnectorError("block_conflict", "msg", { filePath: "/tmp/AGENTS.md" });
    expect(err.code).toBe("block_conflict");
    expect(err.filePath).toBe("/tmp/AGENTS.md");
    expect(err.name).toBe("ConnectorError");
  });

  it("defaults filePath to null", () => {
    const err = new ConnectorError("context_invalid", "msg");
    expect(err.filePath).toBeNull();
  });

  it("rejects unknown codes via schema", () => {
    expect(() => new ConnectorError("nope" as never, "msg")).toThrow();
  });

  it("forwards cause to Error.cause", () => {
    const underlying = new Error("underlying");
    const err = new ConnectorError("file_read_failed", "outer", { cause: underlying });
    expect(err.cause).toBe(underlying);
  });

  it("does not set cause when omitted", () => {
    const err = new ConnectorError("file_read_failed", "outer");
    expect("cause" in err).toBe(false);
  });
});
