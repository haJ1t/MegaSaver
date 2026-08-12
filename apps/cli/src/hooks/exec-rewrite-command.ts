// Flat-token allowlist grammar for the exec-rewrite saver (LD5). Discipline of
// output-route-command.ts: ASCII-space tokens only, SAFE_TOKEN class, caps,
// null-biased — a false positive would rewrite a command the user never
// approved in that shape, so every ambiguity is null.
export const MAX_EXEC_REWRITE_COMMAND_BYTES = 4_096;
const MAX_EXEC_REWRITE_TOKENS = 64;
const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;

// Re-entry safety (LD5): a rewritten command starts with a mega launcher, so
// refusing launchers ANYWHERE makes a second hook pass a structural no-op.
const MEGA_LAUNCHERS = new Set(["mega", "mega.mjs", "mega.cmd", "mega.exe"]);
const GIT_READONLY = new Set(["status", "log", "diff", "show", "branch"]);
const CARGO_ALLOWED = new Set(["test", "build", "check", "clippy"]);
const FIND_MUTATORS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir"]);
// -w means watch for these programs; for grep it is word-match and stays legal.
const WATCH_W_PROGRAMS = new Set(["vitest", "tsc"]);
const PLAIN_PROGRAMS = new Set(["vitest", "tsc", "pytest", "eslint", "ls", "grep", "rg", "find"]);

function isSafeToken(token: string): boolean {
  if (!SAFE_TOKEN.test(token)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control rejection is the point
  return !/[\x00-\x1f\x7f]/.test(token);
}

function basenameOf(token: string): string {
  const i = token.lastIndexOf("/");
  return i === -1 ? token : token.slice(i + 1);
}

export function classifyExecRewrite(command: string): { command: string; args: string[] } | null {
  if (command.length === 0) return null;
  if (Buffer.byteLength(command, "utf8") > MAX_EXEC_REWRITE_COMMAND_BYTES) return null;
  if (/[^\S ]/.test(command) || command !== command.trim()) return null;
  const tokens = command.split(" ");
  if (tokens.length > MAX_EXEC_REWRITE_TOKENS || tokens.some((t) => t.length === 0)) return null;
  if (!tokens.every(isSafeToken)) return null;
  if (tokens.some((t) => MEGA_LAUNCHERS.has(basenameOf(t).toLowerCase()))) return null;

  const program = tokens[0] ?? "";
  if (tokens.includes("--watch")) return null;
  if (WATCH_W_PROGRAMS.has(program) && tokens.includes("-w")) return null;
  if (program === "vitest" && tokens[1] === "watch") return null;

  if (program === "go") {
    if (tokens[1] !== "test") return null;
  } else if (program === "cargo") {
    if (!CARGO_ALLOWED.has(tokens[1] ?? "")) return null;
  } else if (program === "git") {
    if (!GIT_READONLY.has(tokens[1] ?? "")) return null;
  } else if (!PLAIN_PROGRAMS.has(program)) {
    return null;
  }
  if (program === "find" && tokens.some((t) => FIND_MUTATORS.has(t))) return null;

  return { command: program, args: tokens.slice(1) };
}
