> **Superseded by:** [short-term-wave-gap-closure](./2026-08-10-short-term-wave-gap-closure-design.md)

# Instant Tool Failure Airlock & Automated Negative Rule Synthesizer (`mega firewall --mistake-airlock`)

> **Risk Level:** MEDIUM  
> **Status:** Draft / Spec Complete  
> **Target Package:** `@megasaver/core`, `@megasaver/policy`, `@megasaver/cli`, `@megasaver/mcp-bridge`  

## 1. Overview & Problem Statement

Coding agents often make repetitive command syntax mistakes during a session (e.g. running a non-existent CLI flag, bad regex pattern, or misconfigured API endpoint). Currently, FORGE (Phase 5) records failed run attempts, but converting them into active rules requires developer action or post-run processing.

`mega firewall --mistake-airlock` introduces an instant, in-session failure interceptor. When any tool execution returns a non-zero exit code or recognized syntax error, the Mistake Airlock synthesizes a ephemeral "negative rule" (e.g. "Do not pass `--output-format` to `rg`"). If the agent attempts a similar failed tool call within the active session, `@megasaver/policy` blocks or rewrites the tool call before execution.

## 2. Architecture & Pipeline

```
┌─────────────────────────────────────────────────────────┐
│               Agent Tool Execution Result               │
│        (Exit code != 0 / Error output detected)         │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│              Mistake Synthesizer Engine                 │
│  - Parses error patterns (e.g. invalid option/flag)     │
│  - Generates session-scoped negative rule               │
│  - Appends to Session Airlock Ledger                    │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│             @megasaver/policy PreToolUse Gate           │
│  - Matches candidate tool input against Airlock Rules   │
│  - Decision: BLOCK with warning OR AUTO-CORRECT         │
└─────────────────────────────────────────────────────────┘
```

### Core Components:
1. **Mistake Synthesizer (`MistakeSynthesizer`)**: Located in `@megasaver/core/src/mistake-synthesizer.ts`. Generates precise regex/glob matchers for failed tool invocation flags.
2. **Policy PreToolUse Interceptor**: Extended in `@megasaver/policy` to inspect candidate commands against active airlock rules.
3. **CLI Command (`mega firewall --mistake-airlock`)**: Manages session airlock state, listing active negative rules and providing manual release capabilities.

## 3. Data Contracts & Schemas

```typescript
export interface AirlockNegativeRule {
  ruleId: string;
  sessionId: string;
  toolName: string;
  forbiddenPattern: string; // e.g. "rg .* --output-format"
  reason: string; // e.g. "rg: unrecognized option '--output-format'"
  createdAt: string;
  ttlSeconds: number; // default 3600 (active session lifetime)
}
```

## 4. CLI & MCP Surface

- `mega firewall airlock list`: Shows current session airlock negative rules.
- `mega firewall airlock clear`: Clears session airlock negative rules.
- MCP Tool `get_applicable_rules`: Exposes active airlock rules alongside project FORGE rules.

## 5. Testing & Verification

- **Rule Generation Test**: Verify exact error string produces clean negative pattern without over-blocking.
- **PreToolUse Policy Interception Test**: Verify command matching negative rule is denied with descriptive `PolicyDenyCode`.
