import { describe, expectTypeOf, it } from "vitest";
import type { WRITE_ACTION_IDS, WriteAction } from "../src/write-action.js";

describe("WriteAction tuple ordering", () => {
  it("pins [create-memory, create-session, end-session, update-session] alphabetic order", () => {
    expectTypeOf<typeof WRITE_ACTION_IDS>().toEqualTypeOf<
      readonly ["create-memory", "create-session", "end-session", "update-session"]
    >();
  });

  it("WriteAction is the union of the tuple members", () => {
    expectTypeOf<WriteAction>().toEqualTypeOf<
      "create-memory" | "create-session" | "end-session" | "update-session"
    >();
  });
});
