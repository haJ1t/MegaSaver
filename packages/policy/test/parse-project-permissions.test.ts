import { describe, expect, it } from "vitest";
import {
  PolicyLoadError,
  parseProjectPermissions,
} from "../src/parse-project-permissions.js";

describe("parseProjectPermissions — valid shapes (§7 1a)", () => {
  it("compiles deny.read/write globs and keeps deny.commands verbatim", () => {
    const perms = parseProjectPermissions({
      deny: { read: ["creds/**"], write: ["dist/**"], commands: ["make"] },
    });
    expect(perms.denyReadPatterns).toHaveLength(1);
    expect(perms.denyWritePatterns).toHaveLength(1);
    expect(perms.denyCommands).toEqual(["make"]);
    expect(perms.denyReadPatterns[0]).toBeInstanceOf(RegExp);
    // Compiled the same way as SECRET_PATH_PATTERNS: normalizePath-lowered,
    // `/`-unified, anchored, case-insensitive (I4).
    expect(perms.denyReadPatterns[0]?.test("creds/x.txt")).toBe(true);
  });

  it("empty object ⇒ empty permissions (absent deny is not a denial)", () => {
    const perms = parseProjectPermissions({});
    expect(perms.denyReadPatterns).toEqual([]);
    expect(perms.denyWritePatterns).toEqual([]);
    expect(perms.denyCommands).toEqual([]);
  });

  it("deny with missing sub-keys ⇒ empty lists for the omitted keys", () => {
    const perms = parseProjectPermissions({ deny: { commands: ["make"] } });
    expect(perms.denyReadPatterns).toEqual([]);
    expect(perms.denyWritePatterns).toEqual([]);
    expect(perms.denyCommands).toEqual(["make"]);
  });
});

describe("parseProjectPermissions — fail-closed on bad shape (§7 1a, I1/I3)", () => {
  it("unknown top-level key ⇒ PolicyLoadError (.strict)", () => {
    expect(() => parseProjectPermissions({ allow: { commands: ["rm"] } })).toThrow(
      PolicyLoadError,
    );
  });

  it("a stray allow: alongside a valid deny: ⇒ PolicyLoadError (no escalation key, §3.1)", () => {
    expect(() =>
      parseProjectPermissions({ deny: { commands: ["make"] }, allow: { commands: ["rm"] } }),
    ).toThrow(PolicyLoadError);
  });

  it("unknown key inside deny ⇒ PolicyLoadError (deny.strict)", () => {
    expect(() => parseProjectPermissions({ deny: { execute: ["rm"] } })).toThrow(PolicyLoadError);
  });

  it("wrong-typed field (read is a string, not array) ⇒ PolicyLoadError", () => {
    expect(() => parseProjectPermissions({ deny: { read: "creds/**" } })).toThrow(PolicyLoadError);
  });

  it("empty-string glob ⇒ PolicyLoadError (min(1))", () => {
    expect(() => parseProjectPermissions({ deny: { read: [""] } })).toThrow(PolicyLoadError);
  });

  it("non-object raw (null) ⇒ PolicyLoadError", () => {
    expect(() => parseProjectPermissions(null)).toThrow(PolicyLoadError);
  });

  it("non-object raw (array) ⇒ PolicyLoadError", () => {
    expect(() => parseProjectPermissions([])).toThrow(PolicyLoadError);
  });

  it("PolicyLoadError carries the zod cause", () => {
    try {
      parseProjectPermissions({ allow: {} });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyLoadError);
      expect((err as PolicyLoadError).cause).toBeDefined();
    }
  });
});
