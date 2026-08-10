> **Superseded by:** [short-term-wave-gap-closure](./2026-08-10-short-term-wave-gap-closure-design.md)

# Real-Time Cache Churn Doctor & Savings Health Dashboard (`mega cache-doctor`)

> **Risk Level:** MEDIUM  
> **Status:** Draft / Spec Complete  
> **Target Package:** `@megasaver/stats`, `@megasaver/cli`, `@megasaver/gui`  

## 1. Overview & Problem Statement

Mega Saver's core objective is token reduction ("Less tokens. More signal"). However, modern frontier LLMs (such as Claude 3.5 Sonnet or GPT-4o) employ aggressive prompt caching. When Mega Saver hooks modify tool responses in-place (e.g. compressing `stdout` or truncating output), the altered prompt prefix may invalidate the provider's prompt cache, triggering expensive cache creation writes.

Without real-time cache visibility, a 40% output compression might result in a net cost increase due to cache write penalties. `mega cache-doctor` introduces live cache-invalidation accounting, net token dollar delta metrics, and real-time advice to keep token saver operations strictly net-positive.

## 2. Architecture & Components

```
+┌─────────────────────────────────────────────────────────┐
│                    Agent Hook Event                     │
│      (PostToolUse / PreToolUse Output Filter)          │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│             @megasaver/stats Event Recorder             │
│   - Calculates: Raw Output Tokens Saved                 │
│   - Estimates: Prompt Cache Churn & Write Penalty       │
│   - Net Formula: (Tokens Saved * Input Price)           │
│                - (Cache Miss Invalidation Cost)         │
└────────────────────────────┬────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌───────────────────────┐         ┌───────────────────────┐
│  mega audit --cache   │         │  GUI Cache Churn Tab  │
│  (CLI Health Monitor) │         │  (Live Net Chart)     │
└───────────────────────┘         └───────────────────────┘
```

### Core Components:
1. **Cache Churn Meter (`CacheChurnAnalyzer`)**: Located in `@megasaver/stats/src/cache-churn.ts`. Tracks prompt cache hit/miss signals, prompt prefix mutation frequencies, and computes Net Token ROI.
2. **CLI Command (`mega cache-doctor`)**: Exposes live cache health status, identifying tool output hooks that cause high prompt-cache churn.
3. **GUI Cockpit Seam**: Exposes `/api/stats/cache-churn` endpoint returning real-time cache churn metrics and automated mitigation recommendations.

## 3. Data Contracts & Schemas

```typescript
export interface CacheChurnMetric {
  sessionId: string;
  workspaceKey: string;
  toolName: string;
  outputBytesRaw: number;
  outputBytesCompressed: number;
  cachePrefixInvalidated: boolean;
  estimatedCacheWriteTokens: number;
  netSavingsUsd: number;
  recommendation: "keep_enabled" | "increase_floor" | "bypass_compression";
  timestamp: string;
}
```

## 4. CLI & GUI Experience

- `mega audit --cache`: Displays a table of active tool hooks, their compression savings, cache invalidation rate (%), and net USD ROI.
- `mega cache-doctor`: Automated health check that flags hooks where cache-write penalties exceed compression gains, giving actionable recommendations (e.g., "Increase output floor for `rg` to 4KB").

## 5. Testing & Verification

- **Unit Tests**: Test `CacheChurnAnalyzer` with synthetic session event streams containing varying cache hit/miss ratios.
- **Integration Tests**: Verify `mega audit --cache` outputs correct recommendations when cache churn penalties spike.
