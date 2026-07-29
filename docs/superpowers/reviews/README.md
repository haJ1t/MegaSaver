# Saver programme reviews (2026-07-29)

One file per reviewer, so concurrent reviewers never conflict on a shared log.
Name it `<track>-<reviewer>.md`, e.g. `track-a-opus-codereview.md`.

Report each finding as:

```
### <severity: BLOCKER | MAJOR | MINOR | NIT> — <one-line claim>
**Where:** path:line
**Why it is wrong:** the failure, concretely — inputs or state that produce it.
**Evidence:** what you ran or read that shows it. Not "looks wrong".
```

A finding without a concrete failure mode is a NIT. Say so rather than inflating it.

If you conclude the code is correct on a point the handoff flagged as risky, say
that explicitly — "checked X, it holds because Y" is a result, not a non-finding.
