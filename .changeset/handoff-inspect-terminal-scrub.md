---
"@megasaver/cli": patch
---

Scrub control characters out of the payload bodies `mega handoff inspect`
prints. `diagnoseHandoffPacket` populates `parsedPayload` even when the packet
fails its hash or expiry check, so the report echoed `resumeInstructions` and
`taskSummary.text` verbatim below the verdict lines it had just printed —
ANSI cursor-up/erase or a bare CR in those attacker-controlled fields
repaints the verdict. `manifest.sourceProject.name` was already scrubbed for
exactly this reason; both payload bodies were the missed siblings.

Measured on a packet with a wrong `payloadSha256`, a past `expiresAt`, and
`resumeInstructions` = `ESC[7A ESC[2K "hash: ok" CR ESC[2K "expiry: ok"
ESC[6B`, run through the built CLI and piped to `cat -v`:

- before: `^[[7A^[[2Khash: ok^M^[[2Kexpiry: ok^[[6B` reaches stdout intact —
  on a real terminal the screen reads `hash: ok` / `expiry: ok` while the
  program printed `hash: mismatch` / `expiry: expired`.
- after: every ESC/CR/DEL renders as a space; the verdict lines stand.

Newlines and the resulting line structure are preserved — a `\n` cannot
repaint what is already above it, and payload bodies are multi-line by design.
`--json` was never affected (`JSON.stringify` escapes control characters).
