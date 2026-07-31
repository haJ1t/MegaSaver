import { createHash } from "node:crypto";

/**
 * @scaffold WARMSTART PACK ASSEMBLY SCAFFOLD
 * WARNING: Basic pack assembly scaffold. Code-truth memory integration and ranking
 * require the Phase 2 warm-start intent hook.
 */
export interface WarmStartOptions {
  maxTokens?: number;
  timeoutMs?: number;
  repoMapSummary?: string;
  candidateFiles?: string[];
}

export interface WarmStartPack {
  intent: string;
  additionalContext: string;
  characterCount: number;
  isTimedOut: boolean;
  contentHash: string;
  isScaffold: true;
}

export async function generateWarmStartContextPack(
  intent: string,
  options: WarmStartOptions = {},
): Promise<WarmStartPack> {
  const maxTokens = options.maxTokens ?? 4000;
  const timeoutMs = options.timeoutMs ?? 500;
  const startTime = Date.now();

  const assemblyPromise = (async (): Promise<WarmStartPack> => {
    const repoMap = options.repoMapSummary ?? "";
    const files = (options.candidateFiles ?? []).join(", ");

    let rawContext = `<!-- mega-warmstart: intent="${intent}" -->\n[repo_map_summary: ${repoMap}]\n[candidate_files: ${files}]`;

    // Truncate based on character length limit (approx 4 chars per token ceiling estimate)
    const maxChars = maxTokens * 4;
    if (rawContext.length > maxChars) {
      rawContext = rawContext.slice(0, maxChars);
    }

    const characterCount = rawContext.length;
    const contentHash = createHash("sha256").update(rawContext).digest("hex").slice(0, 16);

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      return {
        intent,
        additionalContext: "",
        characterCount: 0,
        isTimedOut: true,
        contentHash: "e3b0c44298fc1c14",
        isScaffold: true,
      };
    }

    return {
      intent,
      additionalContext: rawContext,
      characterCount,
      isTimedOut: false,
      contentHash,
      isScaffold: true,
    };
  })();

  const timeoutPromise = new Promise<WarmStartPack>((resolve) => {
    setTimeout(() => {
      resolve({
        intent,
        additionalContext: "",
        characterCount: 0,
        isTimedOut: true,
        contentHash: "e3b0c44298fc1c14",
        isScaffold: true,
      });
    }, timeoutMs);
  });

  return Promise.race([assemblyPromise, timeoutPromise]);
}
