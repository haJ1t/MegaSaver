import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  CorePersistenceError,
  type CorePersistenceErrorCode,
  CoreRegistryError,
  type CoreRegistryErrorCode,
  corePersistenceErrorCodeSchema,
  coreRegistryErrorCodeSchema,
} from "../src/errors.js";

const codes: ReadonlyArray<CoreRegistryErrorCode> = [
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_already_ended",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
];

const persistenceCodes: ReadonlyArray<CorePersistenceErrorCode> = [
  "store_root_invalid",
  "store_read_failed",
  "store_write_failed",
  "store_json_invalid",
  "store_entity_invalid",
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

describe("corePersistenceErrorCodeSchema", () => {
  it("parses every persistence error code", () => {
    for (const code of persistenceCodes) {
      expect(corePersistenceErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects unknown persistence error codes", () => {
    expect(corePersistenceErrorCodeSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("CorePersistenceError", () => {
  it("carries a stable name, code, message, and file path", () => {
    const error = new CorePersistenceError("store_json_invalid", "Bad JSON.", {
      filePath: "/tmp/store/projects.json",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CorePersistenceError");
    expect(error.code).toBe("store_json_invalid");
    expect(error.message).toBe("Bad JSON.");
    expect(error.filePath).toBe("/tmp/store/projects.json");
  });

  it("defaults filePath to null", () => {
    const error = new CorePersistenceError("store_root_invalid", "Bad root.");

    expect(error.filePath).toBeNull();
  });

  it("validates the persistence code at runtime", () => {
    expect(() => new CorePersistenceError("unknown" as CorePersistenceErrorCode, "Bad.")).toThrow(
      ZodError,
    );
  });
});
