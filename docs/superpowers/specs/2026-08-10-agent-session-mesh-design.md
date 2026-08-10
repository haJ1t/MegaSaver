> **Superseded by:** [short-term-wave-gap-closure](./2026-08-10-short-term-wave-gap-closure-design.md)

# Zero-Latency Agent Session Mesh & Cross-Agent Context Bridge (`mega session mesh`)

> **Risk Level:** HIGH  
> **Status:** Draft / Spec Complete  
> **Target Package:** `@megasaver/core`, `@megasaver/mcp-bridge`, `@megasaver/cli`, `@megasaver/daemon`  

## 1. Overview & Problem Statement

Modern developers frequently work across multiple coding agents simultaneously (e.g. Codex desktop app, Claude Code CLI in terminal, Cursor IDE, Aider). Currently, each agent operates as an isolated island: findings, recent command failures, memory updates, and active task plans made in Codex are invisible to Claude Code or Cursor unless manually exported and imported.

`mega session mesh` establishes a zero-latency, local IPC event mesh managed by `@megasaver/daemon`. When any connected agent records a task step, updates a memory entry, or discovers a critical gotcha, the mesh instantly broadcasts this state across all active agent sessions in real-time.

## 2. Architecture & Components

```
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│    Codex App      │    │  Claude Code CLI  │    │    Cursor IDE     │
│  (MCP / Connector)│    │  (MCP / Connector)│    │  (MCP / Connector)│
└─────────┬─────────┘    └─────────┬─────────┘    └─────────┬─────────┘
          │                        │                        │
          └────────────────────────┼────────────────────────┘
                                   │ IPC (Unix Domain Socket)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 @megasaver/daemon Local Session Mesh                │
│  - Active Agents Roster & Heartbeats                                │
│  - Broadcast Channel: Memories, Task Plans, Failures, Hot Handoffs   │
│  - State Synchronization Ledger                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Components:
1. **Daemon Mesh Hub (`SessionMeshHub`)**: Located in `packages/daemon/src/mesh-hub.ts`. Maintains unix domain socket listener `~/.megasaver/mesh.sock` and active agent heartbeat table.
2. **MCP Tool Bridge (`mesh_broadcast`, `mesh_query`)**: Added to `@megasaver/mcp-bridge` allowing any agent to query what sibling agents are currently doing or broadcast instant context.
3. **CLI Command (`mega session mesh`)**: Lists active connected agent sessions, broadcast logs, and mesh health.

## 3. Data Contracts & Schemas

```typescript
export interface MeshAgentSession {
  agentId: string; // e.g. "codex-desktop-01", "claude-code-cli"
  workspaceKey: string;
  activeTaskBrief?: string;
  lastSeenAt: string;
  capabilities: string[];
}

export interface MeshBroadcastEvent {
  eventId: string;
  senderAgentId: string;
  kind: "memory_added" | "task_step_completed" | "gotcha_discovered" | "handoff_ready";
  payload: Record<string, unknown>;
  timestamp: string;
}
```

## 4. Safety & Fail-Safe Discipline

- Risk Level is HIGH because it communicates across agent processes on local system.
- Socket ownership is restricted to current user (0600 file permissions).
- In the event of daemon crash, agents silently fall back to local disk-based state reading without blocking execution.

## 5. Verification Plan

- **Socket Multi-Client Test**: Verify 3 concurrent sub-process connections sending and receiving cross-agent messages.
- **Failover Test**: Verify system gracefully handles daemon restart or socket drop.
