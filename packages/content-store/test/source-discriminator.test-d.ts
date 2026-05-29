import { type OutputSourceKind, outputSourceKindSchema } from "@megasaver/output-filter";
import { describe, it } from "vitest";
import type { chunkSetSchema } from "../src/chunk-set.js";

type SourceKind = (typeof chunkSetSchema.shape.source.options)[number]["shape"]["kind"]["value"];

describe("ChunkSet source discriminator == OutputSourceKind", () => {
  it("each source discriminator literal is a valid OutputSourceKind", () => {
    const _a: OutputSourceKind = "command";
    const _b: OutputSourceKind = "fetch";
    const _c: OutputSourceKind = "file";
    const _d: OutputSourceKind = "grep";
    void _a;
    void _b;
    void _c;
    void _d;
  });

  it("the discriminator union is assignable to OutputSourceKind and back", () => {
    const _forward: OutputSourceKind = "command" as SourceKind;
    const _back: SourceKind = "command" as OutputSourceKind;
    void _forward;
    void _back;
  });

  it("outputSourceKindSchema.options is the exact alphabetic readonly tuple", () => {
    const _t: readonly ["command", "fetch", "file", "grep"] = outputSourceKindSchema.options;
    void _t;
  });
});
