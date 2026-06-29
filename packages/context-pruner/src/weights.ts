// LAMR factor weights. userMention and testFailure are near-decisive: an
// explicitly named file/symbol or a failing-test block almost always belongs
// in the pack. Penalties are subtracted in finalScore.
export const WEIGHTS = {
  semantic: 1,
  dependency: 0.6,
  coChange: 0.5,
  testFailure: 2.5,
  recentEdit: 0.8,
  memory: 0.7,
  userMention: 3,
  stale: 2,
  noise: 2,
} as const;

// A block must clear this finalScore to be eligible on relevance alone.
// Force-included blocks (userMention / testFailure) bypass it.
export const MIN_RELEVANCE_SCORE = 0.05;
