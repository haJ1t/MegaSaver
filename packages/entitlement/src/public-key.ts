// Mega Saver Pro's Ed25519 license-verification public key (SPKI PEM), baked into
// the CLI. `checkEntitlement` verifies every license signature against it, so a
// license is valid only if it was signed by the matching private key.
//
// The matching private key is held OFFLINE by the vendor (written by
// `scripts/license/gen-keypair.mjs` to the gitignored
// scripts/license/.private-key.pem) and is NEVER committed. To rotate: generate a
// new keypair, replace this constant, and re-issue outstanding licenses.
export const MEGASAVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAFnnrLc0nhaB7RvXy9l2l+yyCNe0dxOxWPf5rup7XrLc=
-----END PUBLIC KEY-----
`;
