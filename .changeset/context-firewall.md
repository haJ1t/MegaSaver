---
"@megasaver/cli": minor
---

mega firewall: context-firewall audit (Pro). policy now detects checksummed
PII (credit card/Luhn, IBAN/mod-97, TR national id) alongside secrets and
counts emails without redacting them; every blocked secret-path read,
redaction, and observation is logged value-free to <store>/firewall/
events.jsonl (always on); `mega firewall` renders the windowed audit —
blocked reads, redactions by detector, observed emails, fixes.
