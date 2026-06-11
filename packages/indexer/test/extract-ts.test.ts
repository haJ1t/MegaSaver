import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../src/code-block.js";
import { extractTs } from "../src/extract/extract-ts.js";

const TS_SOURCE = `import { verify } from "jsonwebtoken";
import { z } from "zod";

export function validateToken(token: string): boolean {
  return verify(token);
}

class AuthService {
  check() {
    return validateToken("x");
  }
}

export interface AuthOptions {
  ttl: number;
}

type Token = string;

const helper = (x: number) => x + 1;
`;

function byName(blocks: ExtractedBlock[], name: string): ExtractedBlock | undefined {
  return blocks.find((b) => b.name === name);
}

describe("extractTs", () => {
  const blocks = extractTs("src/auth.ts", TS_SOURCE);

  it("extracts a function with file imports, exports, and calls", () => {
    const fn = byName(blocks, "validateToken");
    expect(fn?.blockType).toBe("function");
    expect(fn?.exports).toContain("validateToken");
    expect(fn?.imports).toEqual(expect.arrayContaining(["jsonwebtoken", "zod"]));
    expect(fn?.calls).toContain("verify");
    expect((fn?.startLine ?? 0) > 0).toBe(true);
    expect((fn?.endLine ?? 0) >= (fn?.startLine ?? 0)).toBe(true);
  });

  it("classifies a class, interface, and type alias", () => {
    expect(byName(blocks, "AuthService")?.blockType).toBe("class");
    expect(byName(blocks, "AuthOptions")?.blockType).toBe("schema");
    expect(byName(blocks, "Token")?.blockType).toBe("schema");
  });

  it("treats a lowercase arrow const as a function", () => {
    expect(byName(blocks, "helper")?.blockType).toBe("function");
  });

  it("a non-exported declaration has empty exports", () => {
    expect(byName(blocks, "AuthService")?.exports).toEqual([]);
  });

  it("classifies a PascalCase arrow component in a .tsx file", () => {
    const tsx = extractTs("src/Button.tsx", "export const Button = () => <button>x</button>;\n");
    expect(byName(tsx, "Button")?.blockType).toBe("component");
  });

  it("classifies functions under routes/ or api/ as route", () => {
    expect(
      byName(
        extractTs("src/routes/users.ts", "export function getUser() { return 1; }\n"),
        "getUser",
      )?.blockType,
    ).toBe("route");
    expect(
      byName(extractTs("src/api/posts.ts", "export const listPosts = () => [];\n"), "listPosts")
        ?.blockType,
    ).toBe("route");
  });

  it("classifies every block in a *.test.ts file as test", () => {
    const t = extractTs("src/auth.test.ts", "function helpsTest() { return 1; }\n");
    expect(t.every((b) => b.blockType === "test")).toBe(true);
    expect(t.length).toBeGreaterThan(0);
  });

  it("produces a stable contentHash for identical input", () => {
    const a = extractTs("src/auth.ts", TS_SOURCE);
    const b = extractTs("src/auth.ts", TS_SOURCE);
    expect(byName(a, "validateToken")?.contentHash).toBe(byName(b, "validateToken")?.contentHash);
    expect(byName(a, "validateToken")?.contentHash).not.toBe(byName(a, "AuthService")?.contentHash);
  });
});
