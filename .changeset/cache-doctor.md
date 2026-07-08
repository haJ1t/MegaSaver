---
"@megasaver/cli": minor
---

mega cache: prompt-cache doctor. Reads the metering proxy's counts-only usage
log, groups calls into conversations, detects four cache-miss signatures
(no-cache, unstable-prefix, ttl-expiry, model-switch), prices the burn against
the house input rate, and prints a one-line fix per finding. Read-only;
advice-only; never reads message content.
