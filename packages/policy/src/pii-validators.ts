// packages/policy/src/pii-validators.ts
// Checksum validators for the PII redaction patterns (spec §Architecture/1).
// All three never throw on arbitrary digit strings — they return false.

export function luhnValid(digits: string): boolean {
  if (!/^[0-9]{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function ibanValid(candidate: string): boolean {
  const s = candidate.toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  // ISO 13616: move the first four chars to the end, map A→10..Z→35, mod 97
  // computed incrementally so the big number never overflows.
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : ch;
    for (const digit of value) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

export function tcknValid(digits: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(digits)) return false;
  const d = (i: number): number => digits.charCodeAt(i) - 48;
  const odd = d(0) + d(2) + d(4) + d(6) + d(8);
  const even = d(1) + d(3) + d(5) + d(7);
  // JS % can be negative when even > odd*7 — normalize into 0..9.
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  if (d10 !== d(9)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += d(i);
  return sum % 10 === d(10);
}
