// PLACEHOLDER Ed25519 public key (SPKI PEM). The matching private key was
// discarded at generation time and never written anywhere, so NO license can
// verify against this until it is replaced.
//
// TODO owner: replace this with the vendor's real public key. Run
// `node scripts/license/gen-keypair.mjs`, keep the printed private key offline
// (it is written to the gitignored scripts/license/.private-key.pem), and paste
// the printed public SPKI PEM here.
export const MEGASAVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAI/7i1J32MitrKxgglLZkrzaEBALbe/uLx6iHkVnUUrc=
-----END PUBLIC KEY-----
`;
