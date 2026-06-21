import { randomUUID } from "node:crypto";
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type CodeBlockId,
  type MemoryEntryId,
  type ProjectId,
  type SessionId,
  codeBlockIdSchema,
  memoryEntryIdSchema,
  officeAgentIdSchema,
  officeTaskIdSchema,
  projectIdSchema,
  roleIdSchema,
  sessionIdSchema,
} from "../src/ids.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAMPLE_UUID = "11111111-1111-4111-8111-111111111111";

describe.each([
  ["projectIdSchema", projectIdSchema],
  ["sessionIdSchema", sessionIdSchema],
  ["memoryEntryIdSchema", memoryEntryIdSchema],
  ["codeBlockIdSchema", codeBlockIdSchema],
] as const)("%s", (_label, schema) => {
  it("parses a known-valid UUID", () => {
    expect(schema.parse(SAMPLE_UUID)).toBe(SAMPLE_UUID);
  });

  it("accepts a lowercase UUID", () => {
    expect(schema.safeParse(SAMPLE_UUID).success).toBe(true);
  });

  it("rejects an UPPERCASE UUID", () => {
    // hex letters required so toUpperCase actually differs from lowercase
    expect(schema.safeParse("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".toUpperCase()).success).toBe(
      false,
    );
  });

  it("rejects a MixedCase UUID", () => {
    expect(schema.safeParse("11111111-1111-4111-8111-11111111111A").success).toBe(false);
  });

  it("rejects a non-UUID string", () => {
    const result = schema.safeParse("not-a-uuid");
    expect(result.success).toBe(false);
  });

  it("property: any UUID is accepted", () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        expect(schema.parse(id)).toBe(id);
      }),
    );
  });

  it("property: any non-UUID string is rejected", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !UUID_RE.test(s)),
        (s) => {
          expect(schema.safeParse(s).success).toBe(false);
        },
      ),
    );
  });
});

describe("office branded ids", () => {
  it("accepts a lowercase uuid for each office id", () => {
    const id = randomUUID();
    expect(roleIdSchema.parse(id)).toBe(id);
    expect(officeAgentIdSchema.parse(id)).toBe(id);
    expect(officeTaskIdSchema.parse(id)).toBe(id);
  });

  it("rejects an uppercase uuid (case-aliasing guard)", () => {
    const upper = randomUUID().toUpperCase();
    expect(roleIdSchema.safeParse(upper).success).toBe(false);
    expect(officeAgentIdSchema.safeParse(upper).success).toBe(false);
    expect(officeTaskIdSchema.safeParse(upper).success).toBe(false);
  });
});

describe("brand discrimination (compile-time)", () => {
  it("ProjectId, SessionId, MemoryEntryId are mutually unassignable", () => {
    expectTypeOf<ProjectId>().not.toEqualTypeOf<SessionId>();
    expectTypeOf<ProjectId>().not.toEqualTypeOf<MemoryEntryId>();
    expectTypeOf<SessionId>().not.toEqualTypeOf<MemoryEntryId>();
  });

  it("none of the brands collapse to plain string", () => {
    expectTypeOf<ProjectId>().not.toEqualTypeOf<string>();
    expectTypeOf<SessionId>().not.toEqualTypeOf<string>();
    expectTypeOf<MemoryEntryId>().not.toEqualTypeOf<string>();
    expectTypeOf<CodeBlockId>().not.toEqualTypeOf<string>();
  });
});
