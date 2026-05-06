import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CorePersistenceError } from "@megasaver/core";
import { mapErrorToCliMessage } from "../src/errors.js";

describe("mapErrorToCliMessage", () => {
  it("maps a Zod validation failure on `name` to the documented message", () => {
    const result = z.string().trim().min(1).safeParse("   ");
    if (result.success) throw new Error("unreachable");
    expect(mapErrorToCliMessage(result.error, { kind: "name" })).toEqual({
      message: "error: name must be non-empty",
      exitCode: 1,
    });
  });

  it("maps a Zod failure on `--store` to the documented message", () => {
    const result = z.string().trim().min(1).safeParse("");
    if (result.success) throw new Error("unreachable");
    expect(mapErrorToCliMessage(result.error, { kind: "store" })).toEqual({
      message: "error: --store path must be non-empty",
      exitCode: 1,
    });
  });

  it("maps store_json_invalid to a path-bearing corrupt-store message", () => {
    const err = new CorePersistenceError(
      "store_json_invalid",
      "projects.json is not valid JSON",
      { filePath: "/tmp/x/projects.json" },
    );
    expect(mapErrorToCliMessage(err)).toEqual({
      message:
        "error: store at /tmp/x/projects.json is corrupt: projects.json is not valid JSON",
      exitCode: 1,
    });
  });

  it("maps store_entity_invalid the same way as store_json_invalid", () => {
    const err = new CorePersistenceError(
      "store_entity_invalid",
      "stored project failed schema",
      { filePath: "/tmp/y/projects.json" },
    );
    expect(mapErrorToCliMessage(err)).toEqual({
      message:
        "error: store at /tmp/y/projects.json is corrupt: stored project failed schema",
      exitCode: 1,
    });
  });

  it("maps store_read_failed to an I/O message", () => {
    const err = new CorePersistenceError("store_read_failed", "EACCES: permission denied");
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store I/O failed: EACCES: permission denied",
      exitCode: 1,
    });
  });

  it("maps store_write_failed to an I/O message", () => {
    const err = new CorePersistenceError("store_write_failed", "ENOSPC: out of space");
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store I/O failed: ENOSPC: out of space",
      exitCode: 1,
    });
  });

  it("maps store_root_invalid to an I/O message (root unusable)", () => {
    const err = new CorePersistenceError("store_root_invalid", "rootDir is not a directory");
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store I/O failed: rootDir is not a directory",
      exitCode: 1,
    });
  });

  it("rewraps an unknown Error to a generic message (no leak)", () => {
    expect(mapErrorToCliMessage(new Error("boom"))).toEqual({
      message: "error: unexpected failure: boom",
      exitCode: 1,
    });
  });

  it("rewraps a non-Error throwable to a generic message", () => {
    expect(mapErrorToCliMessage("plain string")).toEqual({
      message: "error: unexpected failure",
      exitCode: 1,
    });
  });
});
