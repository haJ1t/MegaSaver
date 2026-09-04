# CLI Copy Dictionary (Max Polish Pass, Faz 3a)

Authoritative terminology + sentence standard for user-visible CLI text
(flag descriptions, help, error/warning messages). Companion to spec
2026-09-03-max-polish-pass-design.md section 4d -- this file OVERRIDES
section 4d sentence-direction assumption where measurement contradicts it.

## 0. Measurement (2026-09-03, apps/cli/src/commands)

- 1027 description strings sampled.
- About 994 match UPPERCASE + trailing period ("Override store directory.",
  "Emit JSON output.") -- the real dominant style.
- 19 lowercase-initial strings are ALL enum value lists
  ("session | week | all.", "safe | medium | dangerous.",
  "on|off|threshold", "threshold value") -- technical value names,
  NOT convertible, documented as exceptions below.
- About 13 genuine outliers: period-less sentences, all in fence/* +
  prompt/index.ts (listed in section 3).

Ruling: the spec section 4d assumption (lowercase start, no trailing period)
is REFUTED by measurement. Converting ~994 strings to a minority style
would be high-churn, high-risk, zero-benefit. Direction reversed:

## 1. Sentence standard

- Descriptions are sentences: start uppercase, end with a period.
- Example: "Override store directory." OK / "Override store directory" BAD.
- Applies to double-quoted, single-quoted, and template-literal description
  forms equally.

## 2. Canonical terms (one correct form each)

| Concept | Canonical form | Wrong variants |
|---|---|---|
| store dir | Override store directory. | Override MegaSaver store directory (missing period; brand prefix unnecessary -- help already scopes to MegaSaver) |
| JSON emit | Emit JSON output. | Emit JSON output (missing period); Emit JSON. kept only where adjacent wording already says output/report; do not churn |
| workspace | Workspace root (defaults to cwd). | -- |
| session | Session id (UUID). / Session id (required for --window session). | -- |
| output file | Write output to a file instead of stdout. | -- |

## 3. Fixes applied (Task 7)

- fence/index.ts: Manage generated-file fence rules and configuration -> period added.
- fence/status.ts: Display fence status and summary statistics -> period added.
- fence/init.ts: Derive and initialize fence.yaml -> period added; Write derived entries to fence.yaml -> period added.
- fence/check.ts: Check if a file path is fenced -> period added; Path to check against fence rules -> period added; Override MegaSaver store directory -> canonical Override store directory.
- fence/allow.ts: Allow editing of a fenced path or glob pattern -> period added; Path or glob pattern to allow -> period added.
- fence allow/check/init/status (4x): Emit JSON output -> Emit JSON output with period.
- (allow.ts fixes were already present in the working tree from the interrupted
  implementer session; verified as part of the 13-line diff, text-only.)

## 4. Documented exceptions (DO NOT convert)

- Enum value lists: session | week | all., safe | medium | dangerous.,
  low | medium | high., info | warning | critical., csv | json (default: csv).,
  auto|micro|standard|reonboard (default auto)., warn|strict.,
  month | week (default: month)., etc. -- value names are technical tokens;
  casing/punctuation follows the token, not the sentence rule.
- Bare value placeholders: on|off|threshold, threshold value
  (prompt/index.ts:31-32) -- positional enum slots, same reason.
- Template-interpolated descriptions: already uppercase+period conformant
  (Token-saver mode (...). Default ....); leave untouched.
- Single-quoted long descriptions: already conformant; leave untouched.
- Placeholder-led descriptions starting with <tokens> etc.: conformant; leave untouched.
- errors.ts `error: ...` messages: machine-readable codes (parsed by tooling/
  docs); casing/punctuation frozen, Task 8 scope-excluded (ruling).
- hooks/core internal invariant throws (lowercase, periodless): developer-
  facing guards, not user copy; Task 8 scope-excluded (ruling).
- commands/ `error:`/`mega proxy:`-prefixed console lines and `(stub)`
  outputs: machine/stub format; Task 8 scope-excluded (ruling).
- Template throws interpolating the rejected value (`Invalid ttl: ${...}.`
  would corrupt the echoed token): uppercase start applies, trailing period
  after the interpolation is machine-hostile - value-echo exception, Task 8
  fix round (board/post.ts ttl/confidence; learn.test.ts path hits errors.ts
  machine code, correctly untouched per ruling v1).

## 5. Task 8 handoff (CLI_COPY_DICT)

- Error/warning/message strings (throw new Error, console.error/warn/log,
  citty stderr lines) inherit the same sentence standard (uppercase start,
  trailing period) unless the string is a value echo, path echo, or
  multi-line template where a period would corrupt machine-readable output;
  those are exceptions, documented when taken.
- Flag name/type/default MUST NOT change in either task; text-only.
