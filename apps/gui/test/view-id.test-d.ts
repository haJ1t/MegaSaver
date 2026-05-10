import { describe, expectTypeOf, it } from "vitest";
import type { VIEW_IDS, ViewId } from "../src/view-id.js";

describe("ViewId tuple ordering", () => {
  it("pins [memory, sessions] alphabetic order", () => {
    expectTypeOf<typeof VIEW_IDS>().toEqualTypeOf<readonly ["memory", "sessions"]>();
  });

  it("ViewId is the union of the tuple members", () => {
    expectTypeOf<ViewId>().toEqualTypeOf<"memory" | "sessions">();
  });
});
