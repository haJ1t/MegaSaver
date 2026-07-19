import { expectTypeOf, it } from "vitest";
import * as longMemory from "../src/index.js";

it("exports the LM0 package marker", () => {
  expectTypeOf(longMemory.LONG_MEMORY_PACKAGE).toEqualTypeOf<string>();
});

it("preserves LM0 exports while adding LM1 contracts", () => {
  expectTypeOf(longMemory.createInMemoryLongMemoryStore).toBeFunction();
  expectTypeOf(longMemory.dispatchRpcLine).toBeFunction();
  expectTypeOf(longMemory.observationSchema).toBeObject();
  expectTypeOf(longMemory.prepareCapture).toBeFunction();
  expectTypeOf<longMemory.RedactionPort>().toMatchTypeOf<{
    version: string;
    redact(input: { text: string; action: string | null }): unknown;
  }>();
});
