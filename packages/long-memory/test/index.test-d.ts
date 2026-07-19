import { expectTypeOf, it } from "vitest";
import * as longMemory from "../src/index.js";

it("exports the LM0 package marker", () => {
  expectTypeOf(longMemory.LONG_MEMORY_PACKAGE).toEqualTypeOf<string>();
});
