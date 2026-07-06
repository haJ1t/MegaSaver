#!/usr/bin/env node
// Vendor keygen — run ONCE by the owner. Generates an Ed25519 keypair, prints
// the public SPKI PEM to paste into packages/entitlement/src/public-key.ts, and
// writes the private PEM to scripts/license/.private-key.pem (gitignored). The
// private key must NEVER be committed and must stay offline.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const privatePath = join(here, ".private-key.pem");

if (existsSync(privatePath)) {
  console.error(
    `refusing to overwrite an existing private key at ${privatePath}. Delete it first if you truly mean to rotate.`,
  );
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

writeFileSync(privatePath, privatePem, { mode: 0o600 });

console.log("Private key written (gitignored):");
console.log(`  ${privatePath}`);
console.log("");
console.log("Paste this PUBLIC key into packages/entitlement/src/public-key.ts:");
console.log("");
console.log(publicPem);
