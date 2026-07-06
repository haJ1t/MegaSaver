---
"@megasaver/cli": patch
---

Bake the production Ed25519 license-verification public key into the CLI. Real
Pro license keys now validate; the placeholder (whose private half was discarded)
is replaced. The matching private key is held offline by the vendor and is never
committed.
