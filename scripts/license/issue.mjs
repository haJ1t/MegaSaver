#!/usr/bin/env node
// Vendor license issuer — signs a Pro license with the offline private key and
// prints the msp_ key to hand to a paying customer. Manual issuance until Stripe.
//
// Usage: node scripts/license/issue.mjs <id> [--exp <iso>] [--priv <path>]
//   <id>          customer/license identifier (not a secret)
//   --exp <iso>   optional ISO-8601 expiry; omitted => never expires
//   --priv <path> private key PEM path (default: scripts/license/.private-key.pem)
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const positional = [];
  let exp = null;
  let priv = join(here, ".private-key.pem");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--exp") {
      exp = argv[++i];
    } else if (a === "--priv") {
      priv = argv[++i];
    } else {
      positional.push(a);
    }
  }
  return { id: positional[0], exp, priv };
}

const { id, exp, priv } = parseArgs(process.argv.slice(2));

if (!id) {
  console.error("usage: node scripts/license/issue.mjs <id> [--exp <iso>] [--priv <path>]");
  process.exit(1);
}

let expUnix = null;
if (exp) {
  const ms = Date.parse(exp);
  if (Number.isNaN(ms)) {
    console.error(`invalid --exp: ${exp} (expected ISO-8601, e.g. 2027-01-01T00:00:00Z)`);
    process.exit(1);
  }
  expUnix = Math.floor(ms / 1000);
}

let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(priv, "utf8"));
} catch (err) {
  console.error(`cannot read private key at ${priv}: ${err.message}`);
  console.error("Run scripts/license/gen-keypair.mjs first, or pass --priv <path>.");
  process.exit(1);
}

const payload = {
  v: 1,
  tier: "pro",
  id,
  iat: Math.floor(Date.now() / 1000),
  exp: expUnix,
};

const payloadBytes = Buffer.from(JSON.stringify(payload));
const sig = sign(null, payloadBytes, privateKey);
const key = `msp_${payloadBytes.toString("base64url")}.${sig.toString("base64url")}`;

console.log(key);
