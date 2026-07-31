import { createHash } from 'node:crypto';

export interface ShadowVerdict {
  verdictId: string;
  isPassing: boolean;
  score: number;
  handle: string;
  summary: string;
}

export function evaluateShadowWorktree(commitRef: string, testsPass: boolean): ShadowVerdict {
  const hash = createHash('sha256').update(`${commitRef}:${testsPass}`).digest('hex').slice(0, 16);
  return {
    verdictId: `verd_${hash}`,
    isPassing: testsPass,
    score: testsPass ? 1.0 : 0.0,
    handle: `mesh://verdict_${hash}`,
    summary: testsPass ? 'PASS: single-line verdict confirmed' : 'FAIL: counterfactual replay rejected',
  };
}
