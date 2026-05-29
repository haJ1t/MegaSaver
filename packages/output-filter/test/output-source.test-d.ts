import { describe, it } from "vitest";
import { type OutputSourceKind, outputSourceKindSchema } from "../src/output-source.js";

describe("OutputSourceKind type regression", () => {
  it("each member is a valid OutputSourceKind", () => {
    const _a: OutputSourceKind = "command";
    const _b: OutputSourceKind = "fetch";
    const _c: OutputSourceKind = "file";
    const _d: OutputSourceKind = "grep";
    void _a;
    void _b;
    void _c;
    void _d;
  });

  it("non-member string literal is not assignable to OutputSourceKind", () => {
    // @ts-expect-error non-member literal is not OutputSourceKind
    const _bad: OutputSourceKind = "yolo";
    void _bad;
  });

  it("non-member string-cast is not assignable to OutputSourceKind", () => {
    // @ts-expect-error arbitrary string is not assignable to OutputSourceKind
    const _bad: OutputSourceKind = "bogus" as string;
    void _bad;
  });

  it("outputSourceKindSchema.options spreads into OutputSourceKind[]", () => {
    const arr: OutputSourceKind[] = [...outputSourceKindSchema.options];
    void arr;
  });

  it("outputSourceKindSchema.options is the exact alphabetic readonly tuple", () => {
    const _t: readonly ["command", "fetch", "file", "grep"] = outputSourceKindSchema.options;
    void _t;
  });
});
