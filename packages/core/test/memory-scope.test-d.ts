import { describe, it } from "vitest";
import { type MemoryScope, memoryScopeSchema } from "../src/memory-entry.js";

describe("MemoryScope type regression", () => {
  it("each v0.1 member is a valid MemoryScope", () => {
    const _a: MemoryScope = "project";
    const _b: MemoryScope = "session";
    void _a;
    void _b;
  });

  it("non-member string literal is not assignable to MemoryScope", () => {
    // @ts-expect-error non-member literal is not MemoryScope
    const _bad: MemoryScope = "global";
    void _bad;
  });

  it("non-member string-cast is not assignable to MemoryScope", () => {
    // @ts-expect-error arbitrary string is not assignable to MemoryScope
    const _bad: MemoryScope = "archive" as string;
    void _bad;
  });

  it("memoryScopeSchema.options spreads into MemoryScope[]", () => {
    // Verifies that options elements are assignable to MemoryScope at the type level.
    const arr: MemoryScope[] = [...memoryScopeSchema.options];
    void arr;
  });

  it("memoryScopeSchema.options preserves semantic order", () => {
    const _t: readonly ["project", "session"] = memoryScopeSchema.options;
    void _t;
  });
});
