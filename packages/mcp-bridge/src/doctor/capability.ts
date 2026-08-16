export type CapabilityClass = "exec" | "network" | "write";

const WRITE_TOKENS = new Set([
  "write",
  "edit",
  "delete",
  "remove",
  "create",
  "update",
  "put",
  "patch",
  "insert",
  "drop",
  "move",
  "rename",
  "upload",
]);

const EXEC_TOKENS = new Set([
  "exec",
  "execute",
  "run",
  "command",
  "shell",
  "bash",
  "spawn",
  "eval",
  "script",
]);

const NETWORK_TOKENS = new Set([
  "fetch",
  "http",
  "https",
  "url",
  "request",
  "download",
  "curl",
  "post",
  "webhook",
  "browse",
  "navigate",
]);

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  let current = "";
  for (const ch of lower) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
      current += ch;
    } else {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function capabilitiesOf(name: string, description?: string): CapabilityClass[] {
  const nameTokens = new Set(tokenize(name));
  const descTokens = description !== undefined ? new Set(tokenize(description)) : null;
  const caps: CapabilityClass[] = [];
  for (const t of WRITE_TOKENS)
    if (nameTokens.has(t) || descTokens?.has(t)) {
      caps.push("write");
      break;
    }
  for (const t of EXEC_TOKENS)
    if (nameTokens.has(t) || descTokens?.has(t)) {
      caps.push("exec");
      break;
    }
  for (const t of NETWORK_TOKENS)
    if (nameTokens.has(t) || descTokens?.has(t)) {
      caps.push("network");
      break;
    }
  return caps.sort() as CapabilityClass[];
}
