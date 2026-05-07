import { ConnectorError } from "@megasaver/connectors-shared";
import { describe, expect, it } from "vitest";
import {
  GenericCliConnectorError,
  genericCliConnectorErrorCodeSchema,
  mapSharedErrorCode,
} from "../src/errors.js";

describe("GenericCliConnectorError", () => {
  it("enumerates the v0.1 code union", () => {
    expect(genericCliConnectorErrorCodeSchema.options).toEqual([
      "context_invalid",
      "block_conflict",
      "file_read_failed",
      "file_write_failed",
      "project_root_invalid",
    ]);
  });

  it("maps shared error codes 1:1", () => {
    expect(mapSharedErrorCode("context_invalid")).toBe("context_invalid");
    expect(mapSharedErrorCode("block_conflict")).toBe("block_conflict");
    expect(mapSharedErrorCode("file_read_failed")).toBe("file_read_failed");
    expect(mapSharedErrorCode("file_write_failed")).toBe("file_write_failed");
    expect(mapSharedErrorCode("target_path_invalid")).toBe("project_root_invalid");
  });

  it("captures code and filePath", () => {
    const err = new GenericCliConnectorError("context_invalid", "msg");
    expect(err.code).toBe("context_invalid");
    expect(err.filePath).toBeNull();
    expect(err.name).toBe("GenericCliConnectorError");
  });

  it("ConnectorError instance is mappable", () => {
    const cause = new ConnectorError("block_conflict", "boom");
    expect(mapSharedErrorCode(cause.code)).toBe("block_conflict");
  });
});
