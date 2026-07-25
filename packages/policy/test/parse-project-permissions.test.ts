import { describe, expect, it } from "vitest";
import { PolicyLoadError, parseProjectPermissions } from "../src/parse-project-permissions.js";

describe("parseProjectPermissions — valid shapes (§7 1a)", () => {
  it("compiles deny.read globs and keeps deny.commands verbatim", () => {
    const perms = parseProjectPermissions({
      deny: { read: ["creds/**"], commands: ["make"] },
    });
    expect(perms.denyReadPatterns).toHaveLength(1);
    expect(perms.denyCommands).toEqual(["make"]);
    expect(typeof perms.denyReadPatterns[0]?.test).toBe("function");
    // Compiled the same way as SECRET_PATH_PATTERNS: normalizePath-lowered,
    // `/`-unified, anchored, case-insensitive (I4).
    expect(perms.denyReadPatterns[0]?.test("creds/x.txt")).toBe(true);
  });

  it("empty object ⇒ empty permissions (absent deny is not a denial)", () => {
    const perms = parseProjectPermissions({});
    expect(perms.denyReadPatterns).toEqual([]);
    expect(perms.denyCommands).toEqual([]);
  });

  it("deny with missing sub-keys ⇒ empty lists for the omitted keys", () => {
    const perms = parseProjectPermissions({ deny: { commands: ["make"] } });
    expect(perms.denyReadPatterns).toEqual([]);
    expect(perms.denyCommands).toEqual(["make"]);
  });
});

// deny.write compiled to denyWritePatterns and NOTHING read it — no
// evaluatePathWrite exists (permissions-yaml §5.4). A correctly-spelled key
// that denies nothing is a false sense of write coverage, so it is rejected
// BY NAME rather than accepted or reported as a typo
// (deny-write-honest-rejection §2, §3.2).
describe("parseProjectPermissions — deny.write is rejected by name", () => {
  const cases: Array<[string, unknown]> = [
    ["a non-empty glob list", { deny: { write: ["dist/**"] } }],
    // Presence is the signal, not content: an empty list still reads as
    // "write rules are a thing here".
    ["an empty list", { deny: { write: [] } }],
    // `write:` with no value in YAML parses to null.
    ["a null value", { deny: { write: null } }],
    ["alongside enforced keys", { deny: { read: ["creds/**"], write: ["dist/**"] } }],
  ];

  for (const [label, raw] of cases) {
    it(`${label} ⇒ PolicyLoadError naming deny.write`, () => {
      expect(() => parseProjectPermissions(raw)).toThrow(PolicyLoadError);
      try {
        parseProjectPermissions(raw);
        expect.unreachable("should have thrown");
      } catch (err) {
        // The message is what the operator sees: resolveEffectiveSettings puts
        // err.message into `detail`, which the file-read and MCP surfaces print.
        expect((err as PolicyLoadError).message).toMatch(/deny\.write/);
        expect((err as PolicyLoadError).message).toMatch(/not enforced/);
        expect((err as PolicyLoadError).cause).toBeDefined();
      }
    });
  }

  it("an absent write key is untouched (the .optional() guard)", () => {
    expect(() => parseProjectPermissions({ deny: { read: ["creds/**"] } })).not.toThrow();
  });

  it("an explicit undefined is accepted — pinned, and unreachable from YAML", () => {
    // `.optional()` cannot distinguish an absent key from a present-but-
    // undefined one, so this shape parses. It is NOT reachable through the one
    // production caller: yaml.parse yields null / "" / [] for every empty-value
    // form (`write:`, `{write: }`, `!!str`, an alias to a null anchor), never
    // undefined — and null IS rejected above. Pinned so a zod upgrade that
    // widens or narrows `.optional()` shows up here rather than silently.
    expect(() => parseProjectPermissions({ deny: { write: undefined } })).not.toThrow();
  });

  it("every OTHER bad shape keeps the generic message (the split did not widen)", () => {
    for (const raw of [{ deny: { execute: ["rm"] } }, { allow: {} }, { deny: { read: "x" } }]) {
      try {
        parseProjectPermissions(raw);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as PolicyLoadError).message).toBe("invalid project permissions");
      }
    }
  });
});

describe("parseProjectPermissions — fail-closed on bad shape (§7 1a, I1/I3)", () => {
  it("unknown top-level key ⇒ PolicyLoadError (.strict)", () => {
    expect(() => parseProjectPermissions({ allow: { commands: ["rm"] } })).toThrow(PolicyLoadError);
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
