---
"@megasaver/stats": minor
"@megasaver/cli": minor
---

Add honest token-reduction metrics: token-weighted eligible reduction reported
alongside eligible/proxied/passthrough/mediated fractions, a GA gate pairing
reduction with an evidence-sufficiency floor, and `mega audit honest`. Passthrough
outputs never create positive savings; the headline reduction is reported as
eligible-mediated-context-only and cannot be inflated by eligibility-set selection.
