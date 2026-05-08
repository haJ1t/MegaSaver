import { CorePersistenceError, CoreRegistryError } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  invalidAgentMessage,
  invalidRiskMessage,
  invalidSessionIdMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
  sessionAlreadyEndedMessage,
  sessionNotFoundMessage,
} from "../src/errors.js";

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
    const err = new CorePersistenceError("store_json_invalid", "projects.json is not valid JSON", {
      filePath: "/tmp/x/projects.json",
    });
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store at /tmp/x/projects.json is corrupt: projects.json is not valid JSON",
      exitCode: 1,
    });
  });

  it("maps store_entity_invalid the same way as store_json_invalid", () => {
    const err = new CorePersistenceError("store_entity_invalid", "stored project failed schema", {
      filePath: "/tmp/y/projects.json",
    });
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store at /tmp/y/projects.json is corrupt: stored project failed schema",
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

  it("maps a Zod failure for control-character names to a distinct message", () => {
    const result = z
      .string()
      .trim()
      .min(1)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — mirrors the production schema guard
      .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
      .safeParse("demo\nfake");
    if (result.success) throw new Error("unreachable");
    expect(mapErrorToCliMessage(result.error, { kind: "name" })).toEqual({
      message: "error: name must not contain control characters",
      exitCode: 1,
    });
  });

  it("maps a Zod failure for a C1 control character (NEL) to the same distinct message", () => {
    const result = z
      .string()
      .trim()
      .min(1)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — mirrors the production schema guard
      .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
      .safeParse("name\x85nel");
    if (result.success) throw new Error("unreachable");
    expect(mapErrorToCliMessage(result.error, { kind: "name" })).toEqual({
      message: "error: name must not contain control characters",
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

describe("session error mappings", () => {
  it("sessionNotFoundMessage formats the documented text and exit code 1", () => {
    expect(sessionNotFoundMessage("abc")).toEqual({
      message: 'error: session "abc" not found',
      exitCode: 1,
    });
  });

  it("sessionAlreadyEndedMessage includes the existing endedAt timestamp", () => {
    expect(sessionAlreadyEndedMessage("abc", "2026-05-08T13:00:00.000Z")).toEqual({
      message: 'error: session "abc" already ended at 2026-05-08T13:00:00.000Z',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels session_not_found through sessionNotFoundMessage", () => {
    const err = new CoreRegistryError("session_not_found", "Session does not exist: abc");
    expect(mapErrorToCliMessage(err, { kind: "session", id: "abc" })).toEqual({
      message: 'error: session "abc" not found',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels project_not_found through projectNotFoundMessage", () => {
    const err = new CoreRegistryError("project_not_found", "Project does not exist: demo");
    expect(mapErrorToCliMessage(err, { kind: "project", name: "demo" })).toEqual({
      message: 'error: project "demo" not found',
      exitCode: 1,
    });
  });
});

describe("error helpers — additional coverage", () => {
  it("invalidAgentMessage formats expected list of valid agents", () => {
    expect(invalidAgentMessage("totally-fake")).toEqual({
      message: 'error: invalid agent "totally-fake", expected: claude-code | codex | generic-cli',
      exitCode: 1,
    });
  });

  it("invalidRiskMessage formats expected list of valid risk levels", () => {
    expect(invalidRiskMessage("ULTRA")).toEqual({
      message: 'error: invalid risk "ULTRA", expected: low | medium | high | critical',
      exitCode: 1,
    });
  });

  it("invalidSessionIdMessage formats the offending value", () => {
    expect(invalidSessionIdMessage("nope")).toEqual({
      message: 'error: invalid session id "nope"',
      exitCode: 1,
    });
  });

  it("projectNotFoundMessage formats the documented text", () => {
    expect(projectNotFoundMessage("ghost")).toEqual({
      message: 'error: project "ghost" not found',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage maps ZodError + title to TITLE_EMPTY_MESSAGE", () => {
    const err = new ZodError([
      {
        code: "too_small",
        minimum: 1,
        type: "string",
        inclusive: true,
        exact: false,
        path: [],
        message: "Too small",
      },
    ]);
    expect(mapErrorToCliMessage(err, { kind: "title" })).toEqual({
      message: "error: title must not be empty",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage maps ZodError + title with control-chars first issue to TITLE_CONTROL_CHARS_MESSAGE", () => {
    const result = z
      .string()
      .trim()
      .min(1)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — mirrors the production schema guard
      .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
      .safeParse("first\nsession");
    if (result.success) throw new Error("unreachable");
    expect(mapErrorToCliMessage(result.error, { kind: "title" })).toEqual({
      message: "error: title must not contain control characters",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage maps ZodError + sessionId to invalidSessionIdMessage with received value", () => {
    const err = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "number",
        path: [],
        message: "Expected string",
      },
    ]);
    expect(mapErrorToCliMessage(err, { kind: "sessionId" })).toEqual({
      message: 'error: invalid session id "number"',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage maps ZodError + sessionId without received to <unknown>", () => {
    const err = new ZodError([{ code: "custom", path: [], message: "no received field here" }]);
    expect(mapErrorToCliMessage(err, { kind: "sessionId" })).toEqual({
      message: 'error: invalid session id "<unknown>"',
      exitCode: 1,
    });
  });
});
