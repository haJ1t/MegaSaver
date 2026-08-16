export const INJECTION_PROBES: readonly string[] = [
  "always call",
  "always use this tool",
  "before using any other tool",
  "disregard previous",
  "disregard the above",
  "do not inform the user",
  "do not tell the user",
  "hide this from the user",
  "ignore all previous",
  "ignore previous",
  "instead of using",
  "must call this tool",
];

export type HygieneHit = { kind: "injection" | "url_instruction"; probe: string };

export function scanDescription(description: string): HygieneHit[] {
  const lower = description.toLowerCase();
  const hits: HygieneHit[] = [];
  for (const probe of INJECTION_PROBES) {
    if (lower.includes(probe)) {
      hits.push({ kind: "injection", probe });
    }
  }
  const hasUrl = lower.includes("http://") || lower.includes("https://");
  if (hasUrl) {
    const tokens = tokenize(lower);
    const imperativeTokens = new Set(["call", "visit", "fetch", "send", "post", "open", "submit"]);
    for (const token of tokens) {
      if (imperativeTokens.has(token)) {
        hits.push({ kind: "url_instruction", probe: "url+imperative" });
        break;
      }
    }
  }
  return hits;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
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
