import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  CoreRegistryError,
  type CoreRegistryErrorCode,
  coreRegistryErrorCodeSchema,
} from "../src/errors.js";

const codes: ReadonlyArray<CoreRegistryErrorCode> = [
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
];

describe("coreRegistryErrorCodeSchema", () => {
  it("parses every registry error code", () => {
    for (const code of codes) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects unknown error codes", () => {
    expect(coreRegistryErrorCodeSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("CoreRegistryError", () => {
  it("carries a stable name, code, and message", () => {
    const error = new CoreRegistryError("project_not_found", "Project does not exist.");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CoreRegistryError");
    expect(error.code).toBe("project_not_found");
    expect(error.message).toBe("Project does not exist.");
  });

  it("validates the code at runtime", () => {
    expect(() => new CoreRegistryError("unknown" as CoreRegistryErrorCode, "Bad.")).toThrow(
      ZodError,
    );
  });
});
