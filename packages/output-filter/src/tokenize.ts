// Shared matching tokenizer: lowercase, NFD, strip combining marks, fold
// dotless ı→i, split on non-alphanumeric (Unicode-aware). Used symmetrically
// on both sides of every intent<->text match (ranking AND json-key selection),
// so a Turkish prompt is no longer inert (D18). ASCII input is byte-identical
// to the old [^a-z0-9] split.
export const tokenizeForMatch = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ı/g, "i")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
