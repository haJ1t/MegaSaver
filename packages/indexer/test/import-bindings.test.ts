import { describe, expect, it } from "vitest";
import { extractTs } from "../src/extract/extract-ts.js";

// extractTs attaches the file's import-binding map (local name → module specifier)
// to every block it returns, so build.ts can resolve calls without re-parsing.
function bindingsOf(filePath: string, source: string): Record<string, string> {
  const blocks = extractTs(filePath, source);
  const first = blocks[0];
  expect(first).toBeDefined();
  return first?.importBindings ?? {};
}

describe("extractTs import bindings", () => {
  it("maps named imports to their module specifier", () => {
    const b = bindingsOf(
      "src/a.ts",
      `import { parse } from "./m";\nexport function useA() { return parse(); }\n`,
    );
    expect(b).toEqual({ parse: "./m" });
  });

  it("maps aliased imports to the local (renamed) name", () => {
    const b = bindingsOf(
      "src/a.ts",
      `import { parse as p } from "./m";\nexport function useA() { return p(); }\n`,
    );
    expect(b).toEqual({ p: "./m" });
  });

  it("maps a default import to its module specifier", () => {
    const b = bindingsOf(
      "src/a.ts",
      `import parse from "./m";\nexport function useA() { return parse(); }\n`,
    );
    expect(b).toEqual({ parse: "./m" });
  });

  it("maps a namespace import to its module specifier", () => {
    const b = bindingsOf(
      "src/a.ts",
      `import * as ns from "./m";\nexport function useA() { return ns.parse(); }\n`,
    );
    expect(b).toEqual({ ns: "./m" });
  });

  it("keeps a bare (npm) specifier as-is", () => {
    const b = bindingsOf(
      "src/a.ts",
      `import { verify } from "jsonwebtoken";\nexport function useA() { return verify(); }\n`,
    );
    expect(b).toEqual({ verify: "jsonwebtoken" });
  });

  it("merges multiple imports including default + named on one statement", () => {
    const b = bindingsOf(
      "src/a.ts",
      `import def, { named, other as ren } from "./m";\nimport { z } from "zod";\nexport function useA() { return def() + named() + ren() + z(); }\n`,
    );
    expect(b).toEqual({ def: "./m", named: "./m", ren: "./m", z: "zod" });
  });
});
