---
"@megasaver/cli": patch
---

Make the saver's net-effect auto-pause visible. Once a workspace was latched to
`negative`, it stopped compressing, so it produced no in-window events, so the
estimator returned `unknown` and `mega doctor` skipped the workspace entirely —
never refreshing the record and never mentioning the pause again. Doctor now
reads the persisted verdict when there is no fresh signal and fails the
`saver-net-effect` check with the resume hint. `mega session saver resolve` also
reports the gate the hook applies after the resolver: new `netEffectPaused` /
`netEffectVerdict` JSON fields, plus an `AUTO-PAUSED` line in human output. The
latch itself is unchanged — `mega session saver resume` remains the only way to
clear it.
