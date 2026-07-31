# Design Spec: Field Telemetry & Workspace Stamping (Child-Spec #1)

> **Date:** August 1, 2026  
> **Package:** `@megasaver/stats`  
> **Risk Level:** **MEDIUM**  
> **Spec Status:** APPROVED  
> **Target Phase:** Phase 0 Grounding (M5, M6, M7 Compliance)

---

## 1. Executive Summary

This specification defines the implementation of **Field Telemetry & Workspace Stamping** in `@megasaver/stats`. It addresses the Phase 0 grounding requirements (M5 statistical soundness, M6 field telemetry necessity, M7 store freshness inspection) and fixes the fail-open and dummy session ID vulnerabilities.

---

## 2. Boundary & Validation Rules

### 2.1 M7 Store Freshness Inspection (`isStoreFresh`)
- **Contract:** `isStoreFresh(storeRoot?: string): boolean`
- **Fail-Closed Rule:** If `storeRoot` is `undefined`, empty, or points to an invalid path, `isStoreFresh` MUST return `false`. (Reverses the unsafe `return true` fail-open vulnerability).
- **Freshness Criterion:** A store root is fresh if and only if:
  1. `storeRoot` is a non-empty string.
  2. `existsSync(storeRoot)` is `true`.
  3. Neither `join(storeRoot, "stats")` nor `join(storeRoot, "content")` exists on disk.

### 2.2 Telemetry Stamping (`stampWorkspaceTelemetry`)
- **Contract:**
  ```typescript
  export interface TelemetryOptions {
    workspacePath: string;
    storeRoot: string;
    liveSessionId: string;
  }

  export function stampWorkspaceTelemetry<T extends Record<string, unknown>>(
    event: T,
    options: TelemetryOptions,
  ): T & {
    workspaceKey: WorkspaceKey;
    liveSessionId: string;
    isFreshStore: boolean;
    createdAt: string;
  }
  ```
- **Validation Rules:**
  - `options.workspacePath` must be a valid, non-empty string. Encoded into `WorkspaceKey` via `encodeWorkspaceKey`.
  - `options.storeRoot` must be validated via `isStoreFresh`.
  - `options.liveSessionId` (or event's `liveSessionId`) MUST be a valid non-empty string. Dummy fallback strings (e.g. `"sess_default"`) are STRICTLY FORBIDDEN as they corrupt session-scoped ledger indexing. If no session ID is supplied, the function throws a Zod validation error (`TelemetryValidationError`).

---

## 3. Data Flow & Testing Requirements

1. **Unit Test Scenarios (`test/workspace-stamp.test.ts`):**
   - Assert `isStoreFresh(undefined)` returns `false` (fail-closed).
   - Assert `isStoreFresh("/nonexistent/path")` returns `false`.
   - Assert `isStoreFresh(freshTempDir)` returns `true`.
   - Assert `isStoreFresh(dirWithStatsSubdir)` returns `false`.
   - Assert `stampWorkspaceTelemetry` throws when `liveSessionId` is missing/empty.
   - Assert `stampWorkspaceTelemetry` correctly stamps `workspaceKey`, `isFreshStore`, and `createdAt`.

---

## 4. DoD Verification
- `pnpm verify` clean across all monorepo packages.
- Zero fake fallbacks or unvalidated paths.
