import { describe, expectTypeOf, it } from "vitest";
import type { FilterDecision, FilterOutputResult } from "../src/index.js";

describe("FilterOutputResult.unchanged marker (C2)", () => {
  it("unchanged is an optional { priorChunkSetId } field", () => {
    expectTypeOf<FilterOutputResult["unchanged"]>().toEqualTypeOf<
      { priorChunkSetId: string } | undefined
    >();
  });

  it("unchanged-marker is a valid FilterDecision", () => {
    expectTypeOf<"unchanged-marker">().toMatchTypeOf<FilterDecision>();
  });

  it("existing fields are unchanged (excerpts stays an array)", () => {
    expectTypeOf<FilterOutputResult["excerpts"]>().toMatchTypeOf<readonly unknown[]>();
    expectTypeOf<FilterOutputResult["summary"]>().toEqualTypeOf<string>();
  });
});
