import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

// Extension → content-type for the assets the vite build actually emits
// (html shell, hashed js/css chunks, self-hosted woff2/woff fonts, inline svg/json).
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

// Serve one file from `distDir` for a non-/api GET. Returns true when it wrote a
// response (a real file under distDir), false when the caller should fall
// through to its 404 (missing file, traversal escape, unmapped extension).
export async function serveStatic(
  res: ServerResponse,
  distDir: string,
  requestPath: string,
): Promise<boolean> {
  const relative = requestPath === "/" ? "index.html" : decodeRelative(requestPath);
  if (relative === undefined) return false;

  // Resolve under distDir, then verify the resolved path never escaped it. This
  // catches ../, encoded ../, and absolute-path smuggling before any fs read.
  const root = resolve(distDir);
  const target = resolve(join(root, relative));
  if (target !== root && !target.startsWith(root + sep)) return false;

  const contentType = CONTENT_TYPES[extname(target).toLowerCase()];
  if (contentType === undefined) return false;

  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    // The lexical check above is defeated by a symlink that sits inside distDir
    // but points out of tree (target is lexically inside root, physically not).
    // Resolve symlinks on BOTH root and target and re-check containment; realpath
    // throws ENOENT for a missing file, which the catch turns into a normal 404.
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) return false;
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    createReadStream(realTarget).pipe(res);
    return true;
  } catch {
    return false;
  }
}

// Decode %2e%2e-style escapes and normalize before the join, so an encoded
// traversal collapses to a real `..` that the resolve()-boundary check rejects.
function decodeRelative(requestPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  return normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
}
