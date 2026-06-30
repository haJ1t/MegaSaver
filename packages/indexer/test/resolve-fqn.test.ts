import { describe, expect, it } from "vitest";
import { resolveCallFqn, resolveModulePath } from "../src/resolve-fqn.js";

const files = new Set(["src/m.ts", "src/util/index.ts", "src/widget.tsx", "src/a.ts"]);
const exists = (p: string): boolean => files.has(p);

describe("resolveModulePath", () => {
  it("resolves a relative specifier to a repo-relative file path (adds extension)", () => {
    expect(resolveModulePath("src/a.ts", "./m", exists)).toBe("src/m.ts");
  });

  it("resolves a parent specifier with ../", () => {
    expect(resolveModulePath("src/util/x.ts", "../m", exists)).toBe("src/m.ts");
  });

  it("resolves a directory specifier to its index file", () => {
    expect(resolveModulePath("src/a.ts", "./util", exists)).toBe("src/util/index.ts");
  });

  it("resolves a .tsx file", () => {
    expect(resolveModulePath("src/a.ts", "./widget", exists)).toBe("src/widget.tsx");
  });

  it("keeps a bare (npm) specifier as-is", () => {
    expect(resolveModulePath("src/a.ts", "zod", exists)).toBe("zod");
  });

  it("keeps a relative specifier that resolves to no file as the raw specifier", () => {
    // Unresolvable relative import: nothing to point at; keep the raw text so the
    // FQN is still stable (just won't match a same-name local block).
    expect(resolveModulePath("src/a.ts", "./missing", exists)).toBe("./missing");
  });
});

describe("resolveCallFqn", () => {
  it("imported binding (relative) → <resolvedFile>#<name>", () => {
    const fqn = resolveCallFqn("src/a.ts", "parse", { parse: "./m" }, exists);
    expect(fqn).toBe("src/m.ts#parse");
  });

  it("imported binding (bare pkg) → <pkg>#<name>", () => {
    const fqn = resolveCallFqn("src/a.ts", "verify", { verify: "jsonwebtoken" }, exists);
    expect(fqn).toBe("jsonwebtoken#verify");
  });

  it("local / unknown name → #<name>", () => {
    const fqn = resolveCallFqn("src/a.ts", "helper", {}, exists);
    expect(fqn).toBe("#helper");
  });
});
