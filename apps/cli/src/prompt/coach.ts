export type DietSuggestion = {
  rule: string;
  suggestion: string;
  tokensBefore: number;
  tokensAfter: number;
  delta: number;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function runDietRules(prompt: string): DietSuggestion | null {
  if (!prompt || prompt.length < 100) return null;
  const before = estimateTokens(prompt);
  // Rule 3: pasted error (check before repeated to avoid path shadowing)
  if (prompt.length > 400 && /at\s+\w+\s+\(.+:\d+:\d+\)/.test(prompt)) {
    return {
      rule: "pasted_error",
      suggestion: "Use paste-airlock instead of inlining stack trace.",
      tokensBefore: before,
      tokensAfter: estimateTokens("paste-airlock"),
      delta: before - 10,
    };
  }
  // Rule 1: repeated mentions
  const pathMatches = prompt.match(/src\/[a-zA-Z0-9_\/\.\-]+\.ts/g);
  if (pathMatches && new Set(pathMatches).size >= 1) {
    const uniq = [...new Set(pathMatches)];
    if (prompt.split(uniq[0] ?? "").length - 1 >= 3) {
      const suggestion = `Mention ${uniq[0]} once and list needs.`;
      const after = estimateTokens(suggestion);
      return {
        rule: "repeated_mentions",
        suggestion,
        tokensBefore: before,
        tokensAfter: after,
        delta: before - after,
      };
    }
  }
  // Rule 2: scaffolding
  const scaffolding = (prompt.match(/please|kindly|could you|I would like/gi) || []).length;
  if (scaffolding > 2) {
    const suggestion = prompt.replace(/please|kindly|could you|I would like/gi, "").trim();
    const after = estimateTokens(suggestion);
    return {
      rule: "scaffolding",
      suggestion: suggestion.slice(0, 200),
      tokensBefore: before,
      tokensAfter: after,
      delta: before - after,
    };
  }
  return null;
}
