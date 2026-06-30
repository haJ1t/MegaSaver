// WS2 light import-binding resolution: turn a bare call name into a
// fully-qualified name (FQN) "<module>#<name>" using the calling FILE's import
// bindings. No ts.Program / type-checker — pure path + binding-map work.

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

// Resolve a path with "." / ".." segments against a containing directory,
// returning a repo-relative POSIX path. Repo paths are always "/"-separated
// (scanRepo normalizes), so this is path-agnostic across OSes.
function joinRelative(fromFile: string, specifier: string): string {
  const baseSegments = fromFile.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") baseSegments.pop();
    else baseSegments.push(segment);
  }
  return baseSegments.join("/");
}

// Resolve a module specifier to a repo-relative file path. A BARE specifier (npm
// pkg) is returned unchanged. A RELATIVE specifier is resolved against the
// importing file's directory, trying file extensions then /index.*; if nothing
// exists, the raw specifier is kept (stable FQN, just won't match a local block).
export function resolveModulePath(
  fromFile: string,
  specifier: string,
  fileExists: (path: string) => boolean,
): string {
  if (!isRelative(specifier)) return specifier;
  const base = joinRelative(fromFile, specifier);
  if (fileExists(base)) return base;
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileExists(base + ext)) return base + ext;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = `${base}/index${ext}`;
    if (fileExists(indexPath)) return indexPath;
  }
  return specifier;
}

// FQN for a call `name` made inside `fromFile`. If `name` is an imported
// binding, the FQN is "<resolvedModule>#<name>"; otherwise (local/unknown) it is
// "#<name>" so it still matches a same-file block's own "<file>#<name>" only when
// the file is the definition site (it won't — local FQN is "#name" by design,
// distinct from the definition FQN; see buildResolvedEdges which treats local
// calls separately via the bare-name fallback).
export function resolveCallFqn(
  fromFile: string,
  name: string,
  bindings: Record<string, string>,
  fileExists: (path: string) => boolean,
): string {
  const specifier = bindings[name];
  if (specifier === undefined) return `#${name}`;
  return `${resolveModulePath(fromFile, specifier, fileExists)}#${name}`;
}

// A defined block's own FQN.
export function blockFqn(filePath: string, name: string): string {
  return `${filePath}#${name}`;
}
