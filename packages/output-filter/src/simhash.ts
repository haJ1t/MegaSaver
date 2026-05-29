const MASK = (1n << 64n) - 1n;

function hashToken(token: string): bigint {
  let h = 1469598103934665603n;
  for (let i = 0; i < token.length; i += 1) {
    h ^= BigInt(token.charCodeAt(i));
    h = (h * 1099511628211n) & MASK;
  }
  return h;
}

export function simhash(text: string): bigint {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  const hashes = tokens.map(hashToken);
  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    const mask = 1n << BigInt(bit);
    let weight = 0;
    for (const h of hashes) weight += h & mask ? 1 : -1;
    if (weight > 0) result |= mask;
  }
  return result;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
