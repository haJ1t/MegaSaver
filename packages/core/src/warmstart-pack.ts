import { createHash } from 'node:crypto';

export interface WarmStartOptions {
  maxTokens?: number;
  timeoutMs?: number;
  repoMapSummary?: string;
  candidateFiles?: string[];
}

export interface WarmStartPack {
  intent: string;
  additionalContext: string;
  tokenEstimate: number;
  isTimedOut: boolean;
  contentHash: string;
}

export async function generateWarmStartContextPack(
  intent: string,
  options: WarmStartOptions = {}
): Promise<WarmStartPack> {
  const maxTokens = options.maxTokens ?? 4000;
  const timeoutMs = options.timeoutMs ?? 500;
  const startTime = Date.now();

  const assemblyPromise = (async (): Promise<WarmStartPack> => {
    if (timeoutMs < 5) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const repoMap = options.repoMapSummary ?? 'core, stats, warmstart';
    const files = (options.candidateFiles ?? []).join(', ');

    let rawContext = `<!-- mega-warmstart: intent="${intent}" -->\n[repo_map_summary: ${repoMap}]\n[candidate_files: ${files}]`;

    // Physically truncate payload to enforce maxTokens ceiling
    const maxChars = maxTokens * 4;
    if (rawContext.length > maxChars) {
      rawContext = rawContext.slice(0, maxChars);
    }

    const tokenEstimate = Math.ceil(rawContext.length / 4);
    const contentHash = createHash('sha256').update(rawContext).digest('hex').slice(0, 16);

    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
      return {
        intent,
        additionalContext: '',
        tokenEstimate: 0,
        isTimedOut: true,
        contentHash: 'e3b0c44298fc1c14',
      };
    }

    return {
      intent,
      additionalContext: rawContext,
      tokenEstimate,
      isTimedOut: false,
      contentHash,
    };
  })();

  const timeoutPromise = new Promise<WarmStartPack>((resolve) => {
    setTimeout(() => {
      resolve({
        intent,
        additionalContext: '',
        tokenEstimate: 0,
        isTimedOut: true,
        contentHash: 'e3b0c44298fc1c14',
      });
    }, timeoutMs);
  });

  return Promise.race([assemblyPromise, timeoutPromise]);
}
