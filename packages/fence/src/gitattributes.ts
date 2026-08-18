export type SkippedGitattributesPattern = {
  pattern: string;
  reason: string;
};

export type TranslateGitattributesResult = {
  globs: readonly string[];
  skipped: readonly SkippedGitattributesPattern[];
};

export function translateGitattributes(raw: string): TranslateGitattributesResult {
  const globs: string[] = [];
  const skipped: SkippedGitattributesPattern[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 2) continue;

    const [pattern, ...attrs] = tokens as [string, ...string[]];

    const hasNegated = attrs.includes("-linguist-generated");
    if (hasNegated) continue;

    const isGenerated =
      attrs.includes("linguist-generated") ||
      attrs.includes("linguist-generated=true");
    if (!isGenerated) continue;

    if (pattern.startsWith("!")) {
      skipped.push({
        pattern,
        reason: "negation patterns unsupported",
      });
      continue;
    }

    if (pattern.includes("[") || pattern.includes("]")) {
      skipped.push({
        pattern,
        reason: "bracket expressions unsupported",
      });
      continue;
    }

    let glob = pattern;
    if (glob.startsWith("/")) {
      glob = glob.slice(1);
    }

    if (glob.endsWith("/")) {
      glob = `${glob}**`;
    } else if (!glob.includes("/")) {
      glob = `**/${glob}`;
    }

    globs.push(glob);
  }

  return { globs, skipped };
}
