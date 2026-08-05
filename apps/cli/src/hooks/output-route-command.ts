// Content-free output-route grammar (2026-08-02 phases 3-4 contract §3).
// Exactly two families, flat ASCII-space tokens, no shell. Every ambiguity is
// null: the hook only ever ADVISES, and a false positive would route advice
// at a command the user never approved for that shape.
export type OutputRouteFamily = "grep" | "find";

export const MAX_OUTPUT_ROUTE_COMMAND_BYTES = 4_096;
const MAX_OUTPUT_ROUTE_TOKENS = 64;

const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;
const GREP_MODIFIERS = new Set(["-n", "-H", "-i", "-F", "-w", "-x"]);

// A relative path: no leading "/", no drive form, no ".." segment. The token
// class already excludes quotes, escapes, glob/brace/tilde expansion,
// assignments, substitutions, pipes, redirects, comments, and controls — and
// this helper re-checks controls defensively because callers hand raw stdin.
function isRelativePathToken(token: string): boolean {
  if (token.length === 0 || token.startsWith("/") || token.startsWith("-")) return false;
  if (/^[A-Za-z]:/.test(token)) return false;
  if (token.split("/").includes("..")) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control rejection is the point
  return !/[\x00-\x1f\x7f]/.test(token);
}

function isSafeToken(token: string): boolean {
  if (!SAFE_TOKEN.test(token)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control rejection is the point
  return !/[\x00-\x1f\x7f]/.test(token);
}

// grep := grep (-r | -R) MODIFIER* -e SAFE_WORD -- REL_PATH+
function classifyGrep(tokens: readonly string[]): OutputRouteFamily | null {
  if (tokens.length < 2) return null;
  const recursive = tokens[1];
  if (recursive !== "-r" && recursive !== "-R") return null;
  let cursor = 2;
  while (cursor < tokens.length && GREP_MODIFIERS.has(tokens[cursor] ?? "")) {
    cursor += 1;
  }
  if (tokens[cursor] !== "-e") return null;
  const pattern = tokens[cursor + 1];
  if (pattern === undefined || !isSafeToken(pattern) || pattern.startsWith("-")) return null;
  cursor += 2;
  if (tokens[cursor] !== "--") return null;
  const paths = tokens.slice(cursor + 1);
  if (paths.length === 0) return null;
  for (const path of paths) {
    if (!isSafeToken(path) || !isRelativePathToken(path)) return null;
  }
  return "grep";
}

// find := find REL_PATH [ -type (f | d | l) ] [ -print ]
function classifyFind(tokens: readonly string[]): OutputRouteFamily | null {
  const path = tokens[1];
  if (path === undefined || !isSafeToken(path) || !isRelativePathToken(path)) return null;
  let cursor = 2;
  if (tokens[cursor] === "-type") {
    const kind = tokens[cursor + 1];
    if (kind !== "f" && kind !== "d" && kind !== "l") return null;
    cursor += 2;
  }
  if (tokens[cursor] === "-print") {
    cursor += 1;
  }
  return cursor === tokens.length ? "find" : null;
}

export function classifyOutputRouteCommand(command: string): OutputRouteFamily | null {
  if (command.length === 0) return null;
  if (Buffer.byteLength(command, "utf8") > MAX_OUTPUT_ROUTE_COMMAND_BYTES) return null;
  // ASCII space is the only separator; tabs/newlines/controls never parse.
  if (/[^\S ]/.test(command) || command !== command.trim()) return null;
  const tokens = command.split(" ");
  if (tokens.length > MAX_OUTPUT_ROUTE_TOKENS || tokens.some((t) => t.length === 0)) return null;
  const program = tokens[0];
  if (program === "grep") return classifyGrep(tokens);
  if (program === "find") return classifyFind(tokens);
  return null;
}
