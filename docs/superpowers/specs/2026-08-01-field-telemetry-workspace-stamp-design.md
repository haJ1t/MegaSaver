# Design Spec: Field Telemetry & Workspace Stamping (Child-Spec #1)

> **Date:** August 1, 2026  
> **Package:** `@megasaver/stats`  
> **Risk Level:** **MEDIUM**  
> **Spec Status:** APPROVED  
> **Target Phase:** Phase 0 Grounding (M5, M6, M7 Compliance)

---

## 1. Executive Summary

This specification defines the implementation of **Field Telemetry & Workspace Stamping** in `@megasaver/stats`. It addresses the Phase 0 grounding requirements (M5 statistical soundness, M6 field telemetry necessity, M7 store freshness inspection) and enforces strict Zod boundary validation with typed `TelemetryValidationError` exceptions.

---

## 2. Boundary & Validation Rules

### 2.1 M7 Store Freshness Inspection (`isStoreFresh`)
- **Contract:** `isStoreFresh(storeRoot?: string): boolean`
- **Fail-Closed Rule:** If `storeRoot` is `undefined`, empty, non-string, or points to a non-existent directory, `isStoreFresh` MUST return `false`.
- **Freshness Criterion:** A store root is fresh if and only if:
  1. `storeRoot` is a non-empty string.
  2. `existsSync(storeRoot)` is `true`.
  3. Neither `join(storeRoot, "stats")` nor `join(storeRoot, "content")` exists on disk.

### 2.2 Telemetry Stamping (`stampWorkspaceTelemetry`)
- **Zod Schema:**
  ```typescript
  export const telemetryOptionsSchema = z.object({
    workspacePath: z.string().trim().min(1, "workspacePath must be non-empty"),
    storeRoot: z.string().trim().min(1, "storeRoot must be non-empty"),
    liveSessionId: z.string().trim().min(1, "liveSessionId must be non-empty"),
  });

  export type TelemetryOptions = z.infer<typeof telemetryOptionsSchema>;
  ```
- **Validation Rules & Error Handling:**
  - If boundary parameters fail validation, `stampWorkspaceTelemetry` MUST throw a typed `TelemetryValidationError` carrying one of the following error codes:
    - `"missing_workspace_path"`: `options.workspacePath` is missing or empty.
    - `"missing_store_root"`: `options.storeRoot` is missing or empty.
    - `"missing_session_id"`: `options.liveSessionId` (and event's `liveSessionId`) is missing or empty.
    - `"schema_invalid"`: options is invalid.
  - Dummy fallback strings (e.g. `"sess_default"`) are STRICTLY FORBIDDEN.

---

## 3. Data Flow & Testing Requirements

1. **Unit Test Scenarios (`test/workspace-stamp.test.ts`):**
   - Assert `isStoreFresh(undefined)` returns `false` (fail-closed).
   - Assert `isStoreFresh("/nonexistent/path")` returns `false`.
   - Assert `isStoreFresh(freshTempDir)` returns `true`.
   - Assert `isStoreFresh(dirWithStatsSubdir)` returns `false`.
   - Assert `stampWorkspaceTelemetry` throws `TelemetryValidationError` with `code: "missing_workspace_path"` when `workspacePath` is empty.
   - Assert `stampWorkspaceTelemetry` throws `TelemetryValidationError` with `code: "missing_session_id"` when `liveSessionId` is empty.
   - Assert `stampWorkspaceTelemetry` throws `TelemetryValidationError` with `code: "missing_store_root"` when `storeRoot` is empty.
   - Assert `stampWorkspaceTelemetry` correctly stamps `workspaceKey`, `isFreshStore`, and `createdAt`.

---

## 4. DoD Verification
- `pnpm verify` clean across all monorepo packages.
- Zero fake fallbacks or unvalidated paths.
