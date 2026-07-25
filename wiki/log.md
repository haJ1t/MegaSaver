## [2026-07-25] fix | dedupe guard margin overstated

Post-merge review of the banded-`dedupe()` fix: the regression guard cleared
its 5 s ceiling by only 1.4x when the fix was reverted (6.8-7.7 s reproduced),
not the 2.7x its comment claimed — and the comment (13.5 s) and the changeset
(17.4 s) disagreed with each other. Neither number had been re-run. Guard now
gates on an n-vs-2n growth ratio (64k/128k lines, 2.75x): 1.95-2.09x idle,
2.06-2.17x under four busy cores, 4.48x reverted. Lesson filed under
[[concepts/unbounded-run-redos]] — minimise per SIDE, not the per-trial ratio.
The sibling classify guard was checked and does NOT share the defect: reverting
`PROSE_ANTI_VI` measures 21.5 s against its 5 s ceiling, matching its changeset.
