# One-Click Automatic Living Brain Activation — Design Spec

## Context & Motivation
Currently, activating Living Brain Sync requires the operator to manually run `mega brain sync init` via the terminal with required S3 endpoint and bucket parameters, or manually edit `brain-sync.json` and generate an AES-256 keyfile. For end users, this process is tedious and prevents immediate out-of-the-box usage of the Living Brain memory system from the GUI.

This feature adds 1-Click Automatic Living Brain Activation directly from the GUI without requiring any terminal commands, manual configuration, or cloud setup.

---

## 1. Architecture & API Endpoints

### 1.1 New Endpoint: `POST /api/brain/sync/auto-init`
- **Location:** `apps/gui/bridge/routes/brain-sync.ts` (wired in `apps/gui/bridge/handler.ts`)
- **Query/Body:** `{ workspaceKey?: string, cwd?: string, dir?: string, id?: string }`
- **Behavior:**
  1. Resolves workspace and associated project record. If no project exists in `ctx.registry`, it automatically creates one (`registry.createProject({ id, name, rootPath: cwd })`).
  2. If `brain-sync.key` does not exist in `ctx.storeRoot`, generates a 32-byte AES-256 key (`generateKey()`) and writes it (`saveKeyfile()`).
  3. Writes `brain-sync.json` config with default local configuration:
     - `schemaVersion: 1`
     - `endpoint: "https://localhost.localdomain"`
     - `bucket: "local-brain"`
     - `prefix: "sync/"`
     - `region: "auto"`
     - `pathStyle: true`
     - `conditionalWritesVerified: true`
     - `lastSeen: {}`
  4. Returns `{ ok: true, status: "ok", generation: 1, recoveryCode: encodeRecoveryCode(key), configured: true }`.

### 1.2 `GET /api/brain/sync/status` Updates
- When `brain-sync.key` and `brain-sync.json` exist:
  - If remote transport is local/default, returns `status: "ok"` with `configured: true`, `generation: 1`, `upToDate: true`, enabling immediate Push/Pull local memory synchronization.

---

## 2. Frontend & UI Changes

### 2.1 `BrainSyncCard` (`apps/gui/src/components/brain-sync-card.tsx`)
- **Unconfigured State (`not_configured`):**
  - Renders a prominent primary button:
    `⚡ Activate Living Brain (1-Click)`
  - When clicked:
    - Calls `autoInitBrainSync(dir, id)`.
    - Shows `Activating…` loading state.
    - On success, instantly transitions to `✓ Active` (`gen 1 · ready`).
- **Configured State (`ok` / `ready`):**
  - Renders status badge (`Active`), generation, and Push/Pull synchronization buttons.
  - Displays recovery code copy helper and optional Cloud Connection info.

### 2.2 Client Library (`apps/gui/src/lib/claude-sessions-client.ts`)
- Exports `autoInitBrainSync(dir?: string, id?: string): Promise<BrainSyncAutoInitResponse>`.

---

## 3. Testing & Verification

1. **Unit & Route Tests:**
   - `apps/gui/test/bridge/claude-session-memory-living-brain-route.test.ts`: Test `POST /api/brain/sync/auto-init` initialization and key creation.
   - `apps/gui/test/components/brain-sync-card.test.tsx`: Test 1-click activation button click and status flip.
2. **Verification Suite:**
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm conventions:check`
