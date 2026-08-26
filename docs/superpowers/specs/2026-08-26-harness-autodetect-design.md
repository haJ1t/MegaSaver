# Harness Auto-Detect + First-Run Auto-Configure — Design Spec

- **Date:** 2026-08-26
- **Risk:** HIGH (connector core path + auto-writing user files at scale during onboarding; closed-enum schema growth)
- **Status:** approved (user directive 2026-08-26: "bilgisayardaki agent harness'leri tespit edip ilk kurulumda otomatik konfigüre et; piyasadan en popüler 30-40 harness'ı bul ve entegre et")
- **Author:** pi (Codex-style session)
- **Reviewer:** pending external code-reviewer pass (hard gate before merge)

## 1. Problem

Mega Saver supports 7 connector targets (claude-code, codex, cursor, aider,
gemini, windsurf, continue), but the 2026 agent-harness market has 35–40 widely
used harnesses. Today:

1. `mega init` hard-codes Claude Code only (hooks + mcp + saver) and ignores
   every other harness installed on the machine.
2. There is no machine-level detection at all — `mega connector list` only
   checks project-local target files, not whether a harness is installed.
3. Users must know by hand which of their installed harnesses Mega Saver can
   configure.

## 2. Goal

During first-run onboarding (`mega init`) and on demand (`mega detect`):

1. **Detect** which agent harnesses are installed on the machine (PATH
   binaries, home config dirs, VS Code extension dirs, project markers).
2. **Report honestly** — exactly which signal matched per harness; no guessing,
   no confidence theater.
3. **Auto-configure** — for every detected harness that Mega Saver can
   configure, seed its context block during `mega init` (when cwd resolves to a
   registered project).

Non-goals (v1):

- GUI integration (AgentSetupDoctor stays Claude-Code-scoped; bridge wiring is
  a follow-up).
- Per-harness hooks/MCP installs (only Claude Code has a hook/MCP surface
  today; the file-based context block is the universal integration).
- Reading or mutating harness-native settings files beyond the existing
  connector block upsert (AGENTS.md/CLAUDE.md/… files only).
- Remote/cloud-only agents with no local footprint (Jules, Replit Agent) —
  undetectable by definition, excluded from the catalog.

## 3. Harness catalog (39 entries)

Research set: the popular 2026 coding-agent harnesses. Categories: `cli`
(terminal agents), `ide` (editors/IDEs with agents), `extension` (editor
plugins). Detection signals are conservative — a signal only ships when the
path/binary is a real, established footprint; false negatives are acceptable,
false positives are not.

### 3.1 CLI harnesses

| id | name | binaries | config dirs | project marker | config target |
|---|---|---|---|---|---|
| claude-code | Claude Code | claude | ~/.claude | CLAUDE.md | claude-code (CLAUDE.md) |
| codex | OpenAI Codex CLI | codex | ~/.codex | AGENTS.md | codex (AGENTS.md) |
| gemini | Gemini CLI | gemini | ~/.gemini | GEMINI.md | gemini (GEMINI.md) |
| aider | Aider | aider, aider-chat | ~/.aider | — | aider (CONVENTIONS.md) |
| opencode | OpenCode | opencode | ~/.config/opencode | AGENTS.md | opencode (.opencode/rules/megasaver.md) |
| goose | Goose (Block) | goose | ~/.config/goose | AGENTS.md | covered-by codex (AGENTS.md) |
| crush | Crush (Charm) | crush | ~/.config/crush | AGENTS.md | covered-by codex |
| amazon-q | Amazon Q Developer CLI | q, aws-q | ~/.aws/amazonq | .amazonq/rules | amazon-q (.amazonq/rules/megasaver.md) |
| copilot | GitHub Copilot CLI | copilot | ~/.config/github-copilot | .github/copilot-instructions.md | copilot (.github/copilot-instructions.md) |
| amp | Amp (Sourcegraph) | amp | ~/.config/amp | AGENTS.md | covered-by codex |
| qwen | Qwen Code | qwen | ~/.qwen | QWEN.md | qwen (QWEN.md) |
| iflow | iFlow CLI | iflow | ~/.iflow | AGENTS.md | covered-by codex |
| plandex | Plandex | plandex, pdx | ~/.plandex | — | detection-only |
| openclaw | OpenClaw | openclaw, clawdbot, moltbot | ~/.openclaw, ~/.clawdbot | — | detection-only |
| droid | Factory Droid | droid | ~/.factory | AGENTS.md | covered-by codex |
| warp | Warp | warp, warp-agent | ~/.warp | AGENTS.md | covered-by codex |
| deepseek | DeepSeek CLI | deepseek, deepseek-cli | ~/.deepseek | — | detection-only |
| hermes | Hermes | hermes | ~/.hermes | — | detection-only |
| openhands | OpenHands | openhands, opendevin | ~/.openhands | — | detection-only |
| gptme | gptme | gptme | ~/.local/share/gptme | — | detection-only |
| grok | Grok CLI | grok, grok-cli | — | — | detection-only |
| bits | Bits (bitmagic) | bits | — | — | detection-only |
| tabby | Tabby | tabby | ~/.tabby | — | detection-only |
| refact | Refact.ai | refact | ~/.refact | — | detection-only |
| cody | Sourcegraph Cody | cody | — | — | detection-only |
| mentat | Mentat | mentat | — | — | detection-only |
| gpt-engineer | GPT Engineer | gpte, gpt-engineer | — | — | detection-only |
| devin | Devin CLI | devin | — | — | detection-only |

### 3.2 IDE harnesses

| id | name | binaries | config dirs | extension dir | project marker | config target |
|---|---|---|---|---|---|---|
| cursor | Cursor | cursor, cursor-agent | ~/.cursor | — | .cursor/rules | cursor (.cursor/rules/megasaver.mdc) |
| windsurf | Windsurf | windsurf | ~/.codeium/windsurf, ~/.windsurf | — | .windsurfrules | windsurf (.windsurfrules) |
| continue | Continue | continue | ~/.continue | — | .continue/rules | continue (.continue/rules/megasaver.md) |
| zed | Zed | zed | ~/.zed | — | .rules | covered-by codex (reads AGENTS.md) |
| trae | Trae | trae | ~/.trae | — | .trae/rules | trae (.trae/rules/megasaver.md) |
| antigravity | Google Antigravity | — | ~/.antigravity | — | .agent/rules | antigravity (.agent/rules/megasaver.md) |

### 3.3 Editor-extension harnesses

| id | name | extension prefix (under ~/.vscode/extensions) | project marker | config target |
|---|---|---|---|---|
| cline | Cline | saoudrizwan.claude-dev | .clinerules | cline (.clinerules/megasaver.md) |
| roo-code | Roo Code | rooveterinaryinc.roo-cline | .roo | roo-code (.roo/rules/megasaver.md) |
| kilo-code | Kilo Code | kilocode.kilo-code | .kilocode/rules | kilo-code (.kilocode/rules/megasaver.md) |
| copilot | (also VS Code surface) | github.copilot | .github/copilot-instructions.md | copilot target shared with CLI surface |
| cody | (also VS Code surface) | sourcegraph.cody-ai | — | detection-only |
| qodo | Qodo Gen | qodo.qodo-gen | — | detection-only |
| avante | avante.nvim | (nvim plugin: ~/.local/share/nvim/lazy/avante.nvim) | .avante/rules | detection-only |

Count: 28 CLI + 6 IDE + 5 extension = 39 (copilot and cody each counted once
with two surfaces). Within the requested 30–40 band.

### 3.4 Signal correctness policy

- A harness is **detected** iff at least one signal matched. Signals are ANDed
  within none, ORed across all — a single real footprint is enough.
- Extension dirs use publisher-prefix matching (`saoudrizwan.claude-dev-*`)
  because extension folders carry version suffixes.
- PATH lookup honors `PATHEXT` on win32; config dirs are home-relative and
  cross-platform; no `/Applications` app-dir signals in v1 (config dirs
  already cover the IDEs cross-platform).
- Detection never reads file *contents*, never spawns harness binaries, never
  touches the network.

## 4. Architecture

### 4.1 New package: `@megasaver/harness-detect`

Leaf package. Dependencies: `@megasaver/shared` (AgentId type) + `zod`. No
core edge (AA1 §3c discipline), no fs in the pure engine.

```
packages/harness-detect/src/
  catalog.ts    — HARNESS_CATALOG: 39 frozen HarnessDescriptor records
  detect.ts     — detectHarnesses({ probes }): pure, probe-injected engine
  probes.ts     — createNodeProbes({ home, projectRoot, platform, envPath }):
                   real fs/PATH probe adapters (existsSync/readdirSync)
  schema.ts     — zod schemas for descriptor + result shapes
  index.ts      — public surface re-export
```

Types:

```ts
type HarnessCategory = "cli" | "ide" | "extension";

interface HarnessDescriptor {
  id: AgentId;
  name: string;
  category: HarnessCategory;
  binaries: readonly string[];
  configDirs: readonly string[];        // "~/.cursor" home-relative
  extensionDirs: readonly { parent: string; prefix: string }[];
  projectMarkers: readonly string[];    // project-root-relative
  connectorTargetId: string | null;     // dedicated ConnectorTarget id
  coveredByTargetId: string | null;     // shared-file fallback (AGENTS.md family)
}

type DetectionProbes = {
  binaryExists(name: string): boolean;
  homePathExists(homeRelativePath: string): boolean;
  extensionDirExists(parentHomeRelative: string, prefix: string): boolean;
  projectMarkerExists(relativePath: string): boolean;
};

type HarnessDetection = {
  id: AgentId; name: string; category: HarnessCategory;
  detected: boolean;
  matchedSignals: readonly { kind: "binary"|"config-dir"|"extension-dir"|"project-marker"; detail: string }[];
  connectorTargetId: string | null;
  coveredByTargetId: string | null;
  effectiveTargetId: string | null;   // connectorTargetId ?? coveredByTargetId ?? null
};

detectHarnesses({ probes, ids? }): HarnessDetection[]  // catalog order
```

`effectiveTargetId` is the auto-configure key: the AGENTS.md-family harnesses
(goose, crush, amp, iflow, droid, warp, zed) fold onto the codex target.

### 4.2 `agentIdSchema` growth (shared)

8 → 40 members (alphabetic, additive). New ids: amazon-q, amp, antigravity,
avante, bits, cline, copilot, cody, crush, deepseek, devin, droid, gpt-engineer,
gptme, goose, grok, hermes, iflow, kilo-code, mentat, opencode, openclaw,
openhands, plandex, qodo, qwen, refact, roo-code, tabby, trae, warp, zed.
Closed-set-derived CLI surfaces (`invalidAgentMessage`, `--agent` help) update
automatically. Session tracking (`mega session create --agent goose`) becomes
first-class for every catalog harness.

### 4.3 New connector targets (generic-cli, 6 → 15)

Flat-file markdown targets, no frontmatter headers (only cursor carries
frontmatter today), all OPEN handoff profiles (accepts diff, no cap — same
posture as gemini/continue; ceilings unknown, and the block stays small):

- `clineTarget` → `.clinerules/megasaver.md`
- `rooCodeTarget` → `.roo/rules/megasaver.md`
- `kiloCodeTarget` → `.kilocode/rules/megasaver.md`
- `copilotTarget` → `.github/copilot-instructions.md`
- `opencodeTarget` → `.opencode/rules/megasaver.md`
- `amazonQTarget` → `.amazonq/rules/megasaver.md`
- `qwenTarget` → `QWEN.md`
- `traeTarget` → `.trae/rules/megasaver.md`
- `antigravityTarget` → `.agent/rules/megasaver.md`

`KNOWN_TARGETS` (CLI) 7 → 16; GUI bridge mirror updated in lockstep; the
conformance-matrix test auto-covers every new target.

### 4.4 CLI: `mega detect [--json]`

Top-level command (sibling of `doctor`/`discover` — detection is broader than
connectors). Builds `createNodeProbes` from `HOME`/cwd/platform/`PATH`, runs
the full catalog, prints one line per harness + summary. `--json` emits the
full record array. Always exit 0 (informational). Text line format:

```
<id padded>  <name padded>  <category>  <detected|absent>  signals=<a;b>  target=<effectiveTargetId|->
```

### 4.5 CLI: `mega init` harness step

`runInit` gains step 4 "scan + auto-configure harnesses" (deps-injected, same
continue-and-report pattern). Behavior:

1. Run detection (machine-level; project markers against cwd).
2. Report detected count + per-detected lines.
3. Auto-configure: unique `effectiveTargetId` set of *detected* harnesses;
   resolve the project via `findProjectByCwd`; if no project → honest skip
   line (hint: `mega project create` + `mega connector sync`), step still OK.
4. If project: run the existing `runConnectorSync` once per unique target id
   with `targetFlag=<id>` (seeding mode — creates the file). Any sync failure
   → step fails.

The step runs inside the single existing "Proceed?" confirm; non-TTY/`--yes`
proceeds unchanged. `mega up` (project funnel) is left untouched — its DETECT
already covers its scope; folding the catalog in is a follow-up.

## 5. Honest-detection contract

- `detected` is a fact statement about matched signals, nothing more.
- No "likely installed" tiers, no version claims, no telemetry.
- A detection with zero signals is impossible by construction (absent).
- Auto-configure only ever writes the standard sentinel-bounded block through
  the existing atomic connector path — no other writes, no deletions.

## 6. Testing strategy (TDD)

- `harness-detect` unit: catalog invariants (39 entries, unique ids, ids ⊆
  agentIdSchema, alphabetic agentId growth guard, target refs resolve against
  KNOWN_TARGET_IDS via a CLI-side test), pure engine with fake probes (all
  signal kinds, effectiveTargetId folding, id filtering), real-probe PATH
  lookup (PATHEXT on win32 simulated), extension prefix matching.
- `generic-cli`: targets grow 6 → 15 pins.
- `shared`: agent-id member pins 8 → 40 (property + order).
- CLI: `detect` text/json rendering + exit 0; `init` harness step
  (detected+project → sync called per unique target; no project → skip-ok;
  zero detected → honest line); dependency-graph allow-list grows.

## 7. Risks & mitigations

- **False positives from short binary names** (`q`, `bits`, `grok`): accepted
  residual risk; names are namespaced by PATH reality, and detection is
  informational. Auto-configure only writes the standard block.
- **Enum growth ripple**: additive only; derived surfaces self-update; member
  pins updated in the same commit; `invalidAgentMessage` stays generated.
- **AGENTS.md family folding**: goose/crush/… all seed the same AGENTS.md file
  once (unique target set), matching the one-file-many-readers convention.

## 8. Out of scope / follow-ups

- GUI AgentSetupDoctor + `/api/detect` bridge route.
- `mega up` DETECT folding the catalog.
- Per-harness hook/MCP installers beyond Claude Code.
- Windows `/Applications`-equivalent app-dir signals.
