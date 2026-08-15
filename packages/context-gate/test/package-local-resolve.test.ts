import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalResolver, hasTokenBoundaryMatch } from "../src/package-local-resolve.js";

const roots: string[] = [];
function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-local-resolve-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const npm = (name: string) => ({ name, ecosystem: "npm" as const });
const pypi = (name: string) => ({ name, ecosystem: "pypi" as const });

describe("npm tier-1 resolution", () => {
  it("resolves via nearest package.json dependency fields", () => {
    const root = createRoot();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { citty: "^0.1.6" }, devDependencies: { vitest: "^2" } }),
    );
    const r = createLocalResolver(join(root));
    expect(r.resolves(npm("citty"))).toBe(true);
    expect(r.resolves(npm("vitest"))).toBe(true);
    expect(r.resolves(npm("left-padd"))).toBe(false);
  });
  it("resolves via node_modules presence (scoped and unscoped)", () => {
    const root = createRoot();
    mkdirSync(join(root, "node_modules", "@scope", "pkg"), { recursive: true });
    mkdirSync(join(root, "node_modules", "zod"), { recursive: true });
    const r = createLocalResolver(root);
    expect(r.resolves(npm("@scope/pkg"))).toBe(true);
    expect(r.resolves(npm("zod"))).toBe(true);
  });
  it("resolves via pnpm-lock.yaml without matching name prefixes", () => {
    const root = createRoot();
    writeFileSync(
      join(root, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "packages:",
        "  /preact@10.19.2:",
        "    resolution: {integrity: sha512-abc}",
      ].join("\n"),
    );
    const r = createLocalResolver(root);
    expect(r.resolves(npm("preact"))).toBe(true);
    expect(r.resolves(npm("react"))).toBe(false); // "/preact@" must not satisfy "react"
  });
  it("walks up from a nested start dir and stops at the .git level", () => {
    const root = createRoot();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "packages", "app", "src", "deep"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { execa: "^9" } }));
    const r = createLocalResolver(join(root, "packages", "app", "src", "deep"));
    expect(r.resolves(npm("execa"))).toBe(true);
  });
});

describe("pypi tier-1 resolution", () => {
  it("resolves via requirements.txt / pyproject.toml with token boundaries", () => {
    const root = createRoot();
    writeFileSync(join(root, "requirements.txt"), "requests-toolbelt==1.0.0\nnumpy==1.26.4\n");
    writeFileSync(
      join(root, "pyproject.toml"),
      '[project]\ndependencies = ["python-dateutil>=2.9"]\n',
    );
    const r = createLocalResolver(root);
    expect(r.resolves(pypi("numpy"))).toBe(true);
    expect(r.resolves(pypi("python-dateutil"))).toBe(true);
    expect(r.resolves(pypi("requests"))).toBe(false); // inside requests-toolbelt: boundary blocks it
  });
  it("matches underscore/hyphen spelling variants (PEP 503)", () => {
    const root = createRoot();
    writeFileSync(join(root, "requirements.txt"), "typing_extensions==4.12.2\n");
    expect(createLocalResolver(root).resolves(pypi("typing-extensions"))).toBe(true);
  });
  it("resolves project-local modules via file probes (architect M3)", () => {
    const root = createRoot();
    mkdirSync(join(root, "mymod"), { recursive: true });
    writeFileSync(join(root, "mymod", "__init__.py"), "");
    writeFileSync(join(root, "utils.py"), "");
    writeFileSync(join(root, "snake_case_helper.py"), "");
    const r = createLocalResolver(root);
    expect(r.resolves(pypi("mymod"))).toBe(true);
    expect(r.resolves(pypi("utils"))).toBe(true);
    expect(r.resolves(pypi("snake-case-helper"))).toBe(true); // _ variant probe
    expect(r.resolves(pypi("requests"))).toBe(false);
  });
});

describe("FIFO/device gate (critic B1)", () => {
  it.skipIf(process.platform === "win32")(
    "a FIFO at a probed path never blocks the resolver",
    () => {
      const root = createRoot();
      execSync(`mkfifo "${join(root, "package.json")}"`);
      const started = Date.now();
      const r = createLocalResolver(root);
      expect(r.resolves(npm("left-padd"))).toBe(false);
      expect(Date.now() - started).toBeLessThan(2_000);
    },
  );
});

describe("hasTokenBoundaryMatch", () => {
  it.each([
    ["numpy==1.26", "numpy", true],
    ["requests-toolbelt", "requests", false],
    ["preact@10", "react", false],
    ['deps = ["rich"]', "rich", true],
  ] as const)("(%s, %s) -> %s", (text, needle, expected) => {
    expect(hasTokenBoundaryMatch(text, needle)).toBe(expected);
  });
});
