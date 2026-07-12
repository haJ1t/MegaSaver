---
"@megasaver/brain-sync": minor
"@megasaver/cli": minor
---

`mega brain sync` — E2E-encrypted sync of the portable project brain through
the user's own S3-compatible bucket (Mega Saver Pro). `init` verifies the
endpoint enforces conditional writes and generates a keyfile + one-time
recovery code; `push`/`pull`/`status`/`reset <project>` run a CAS-protected
manifest protocol; all content is AES-256-GCM encrypted client-side — the
provider only ever sees ciphertext.
