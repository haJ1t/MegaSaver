import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

export function canonicalDirectoryAnchorPath(path: string): string {
  const absolute = resolve(path);
  if (process.platform !== "darwin") return absolute;
  const root = parse(absolute).root;
  const [first, ...rest] = relative(root, absolute).split(sep).filter(Boolean);
  const alias = first === "tmp" ? "/tmp" : first === "var" ? "/var" : null;
  const target = alias === "/tmp" ? "/private/tmp" : alias === "/var" ? "/private/var" : null;
  if (alias === null || target === null) return absolute;
  try {
    const aliasStats = lstatSync(alias);
    const parentStats = lstatSync(dirname(alias));
    if (
      !aliasStats.isSymbolicLink() ||
      aliasStats.uid !== 0 ||
      parentStats.uid !== 0 ||
      (parentStats.mode & 0o022) !== 0 ||
      realpathSync(alias) !== target
    ) {
      return absolute;
    }
    return join(target, ...rest);
  } catch {
    return absolute;
  }
}
