export type DisclosureReport = {
  claimed: string[];
  observed: string[];
  undisclosed: string[];
  phantom: string[];
};

export function reconcileDisclosure(input: {
  claimed: readonly string[];
  observed: readonly string[];
}): DisclosureReport {
  const claimed = [...new Set(input.claimed)].sort();
  const observed = [...new Set(input.observed)].sort();
  const claimedSet = new Set(claimed);
  const observedSet = new Set(observed);
  return {
    claimed,
    observed,
    undisclosed: observed.filter((p) => !claimedSet.has(p)),
    phantom: claimed.filter((p) => !observedSet.has(p)),
  };
}
