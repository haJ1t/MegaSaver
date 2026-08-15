import { builtinModules } from "node:module";
import { PYPI_IMPORT_ALIASES } from "./data/pypi-import-aliases.js";
import { PYTHON_STDLIB } from "./data/python-stdlib.js";

export type PackageEcosystem = "npm" | "pypi";
export type PackageRef = { readonly name: string; readonly ecosystem: PackageEcosystem };
export type PackageEditKind =
  | { readonly kind: "source"; readonly ecosystem: PackageEcosystem }
  | { readonly kind: "manifest"; readonly ecosystem: PackageEcosystem };

export const PACKAGE_SCAN_CAP = 262_144; // chars scanned per edit
export const MAX_REFS_PER_EDIT = 64;

// Linear by construction: literal keyword anchor, bounded whitespace run, one
// negated-class capture bounded {1,300} that excludes its own delimiters.
const FROM_SPEC = /\bfrom\s{1,32}["']([^"'\r\n]{1,300})["']/g;
const BARE_IMPORT = /\bimport\s{1,32}["']([^"'\r\n]{1,300})["']/g;
const CALL_SPEC = /\b(?:require|import)\s{0,8}\(\s{0,8}["']([^"'\r\n]{1,300})["']\s{0,8}\)/g;
// Python: applied per line AFTER split("\n") + trimStart() — never ^\s* under m
// (wiki/concepts/redos-case-output-filter).
const PY_FROM = /^from\s{1,32}([A-Za-z_][A-Za-z0-9_.]{0,200})\s{1,32}import\b/;
const PY_IMPORT = /^import\s{1,32}([A-Za-z0-9_., ]{1,300})/;
const PY_MODULE = /^[A-Za-z_][A-Za-z0-9_]{0,100}(?:\.[A-Za-z_][A-Za-z0-9_]{0,100}){0,10}$/;
const NPM_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]{0,100}\/)?[a-z0-9~][a-z0-9._~-]{0,213}$/;
const PYPI_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/;
const REQUIREMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}/;

const JS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const PY_EXTENSIONS = new Set([".py", ".pyi", ".pyw"]);
const BUILTINS = new Set(builtinModules);

export function isValidPackageName(name: string, ecosystem: PackageEcosystem): boolean {
  if (ecosystem === "npm") {
    return name.length <= 214 && NPM_NAME.test(name);
  }
  return name.length <= 100 && PYPI_NAME.test(name);
}

export function normalizePypiName(raw: string): string {
  return raw.toLowerCase().replace(/[-_.]+/g, "-");
}

export function classifyPackageEdit(filePath: string): PackageEditKind | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith("/package.json")) return { kind: "manifest", ecosystem: "npm" };
  const base = lower.split("/").pop() ?? lower;
  if (base.startsWith("requirements") && base.endsWith(".txt")) {
    return { kind: "manifest", ecosystem: "pypi" };
  }
  for (const ext of JS_EXTENSIONS) {
    if (lower.endsWith(ext)) return { kind: "source", ecosystem: "npm" };
  }
  for (const ext of PY_EXTENSIONS) {
    if (lower.endsWith(ext)) return { kind: "source", ecosystem: "pypi" };
  }
  return null;
}

function npmNameFromSpecifier(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:") ||
    specifier.startsWith("node:") ||
    BUILTINS.has(specifier)
  ) {
    return null;
  }
  let name = specifier;
  if (name.startsWith("@")) {
    const parts = name.split("/");
    if (parts.length < 2) return null;
    name = `${parts[0]}/${parts[1]}`;
  } else if (name.includes("/")) {
    name = name.split("/")[0] as string;
  }
  if (name.length > 214 || !NPM_NAME.test(name)) return null;
  return name;
}

function pypiNameFromModule(rawModule: string): string | null {
  if (rawModule === "") return null;
  if (!PY_MODULE.test(rawModule)) return null;
  const topLevel = rawModule.split(".")[0] as string;
  const alias = PYPI_IMPORT_ALIASES[topLevel];
  if (alias !== undefined) return alias;
  const normalized = normalizePypiName(topLevel);
  if (PYTHON_STDLIB.has(normalized) || PYTHON_STDLIB.has(topLevel)) return null;
  if (!isValidPackageName(normalized, "pypi")) return null;
  return normalized;
}

function extractNpmSource(text: string, push: (name: string) => void): void {
  const patterns = [FROM_SPEC, BARE_IMPORT, CALL_SPEC];
  // Per-line scan (all patterns per line) so results keep TEXT order — a
  // pattern-major scan reorders matches across lines (bare import on line N
  // would surface after a `from` specifier on line N+1).
  for (const line of text.split("\n")) {
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        const name = npmNameFromSpecifier(match[1] ?? "");
        if (name !== null) push(name);
      }
    }
  }
}

function extractPySource(text: string, push: (name: string) => void): void {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimStart();
    const from = PY_FROM.exec(line);
    if (from !== null) {
      const name = pypiNameFromModule(from[1] ?? "");
      if (name !== null) push(name);
      continue;
    }
    const imp = PY_IMPORT.exec(line);
    if (imp !== null) {
      for (const rawModule of (imp[1] ?? "").split(",")) {
        const withoutAs = rawModule.trim().split(/\s+as\s+/)[0]?.trim() ?? "";
        const name = pypiNameFromModule(withoutAs);
        if (name !== null) push(name);
      }
    }
  }
}

function extractNpmManifest(text: string, push: (name: string) => void): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  for (const field of fields) {
    const deps = (parsed as Record<string, unknown>)[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec === "string") {
        const trimmed = spec.trimStart();
        if (
          trimmed.startsWith("workspace:") ||
          trimmed.startsWith("file:") ||
          trimmed.startsWith("link:") ||
          trimmed.startsWith("portal:")
        ) {
          continue;
        }
      }
      if (isValidPackageName(name, "npm")) push(name);
    }
  }
}

function extractPyManifest(text: string, push: (name: string) => void): void {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("-")) continue;
    const match = REQUIREMENT_NAME.exec(line);
    if (match === null) continue;
    const name = normalizePypiName(match[0]);
    if (isValidPackageName(name, "pypi")) push(name);
  }
}

export function extractPackageRefs(edit: PackageEditKind, newText: string): PackageRef[] {
  const text = newText.slice(0, PACKAGE_SCAN_CAP);
  const refs: PackageRef[] = [];
  const seen = new Set<string>();
  const push = (name: string): void => {
    if (refs.length >= MAX_REFS_PER_EDIT) return;
    const key = `${edit.ecosystem}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ name, ecosystem: edit.ecosystem });
  };
  if (edit.kind === "source") {
    if (edit.ecosystem === "npm") extractNpmSource(text, push);
    else extractPySource(text, push);
  } else if (edit.ecosystem === "npm") {
    extractNpmManifest(text, push);
  } else {
    extractPyManifest(text, push);
  }
  return refs;
}
