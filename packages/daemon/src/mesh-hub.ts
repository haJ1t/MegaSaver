import { chmod, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { daemonDir, meshSocketPath } from "./paths.js";

export interface MeshAgentSession {
  agentId: string;
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

export class SessionMeshHub {
  #storeRoot: string;
  #server: Server | null = null;
  #clients = new Set<Socket>();
  #sessions = new Map<string, MeshAgentSession>();
  #log: MeshBroadcastEvent[] = [];

  constructor(storeRoot: string) {
    this.#storeRoot = storeRoot;
  }

  async start(): Promise<void> {
    const sock = meshSocketPath(this.#storeRoot);
    if (process.platform !== "win32") {
      await mkdir(daemonDir(this.#storeRoot), { recursive: true });
      try {
        await unlink(sock);
      } catch {}
    }
    this.#server = createServer((socket) => {
      this.#clients.add(socket);
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as MeshBroadcastEvent & { agentId?: string; workspaceKey?: string };
            if (ev.agentId !== undefined && ev.workspaceKey !== undefined) {
              this.#sessions.set(ev.agentId, {
                agentId: ev.agentId,
                workspaceKey: ev.workspaceKey,
                lastSeenAt: new Date().toISOString(),
                capabilities: [],
              });
            }
          } catch {}
        }
      });
      socket.on("close", () => this.#clients.delete(socket));
      socket.on("error", () => this.#clients.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      const srv = this.#server;
      if (srv === null) {
        reject(new Error("server not initialized"));
        return;
      }
      srv.listen(sock, () => resolve());
      srv.on("error", reject);
    });

    if (process.platform !== "win32") {
      try {
        await chmod(sock, 0o600);
      } catch {}
    }
  }

  async stop(): Promise<void> {
    for (const c of this.#clients) c.destroy();
    this.#clients.clear();
    if (this.#server !== null) {
      await new Promise<void>((res) => this.#server!.close(() => res()));
      this.#server = null;
    }
    if (process.platform !== "win32") {
      try {
        await unlink(meshSocketPath(this.#storeRoot));
      } catch {}
    }
  }

  async broadcast(event: MeshBroadcastEvent): Promise<void> {
    this.#log.push(event);
    const line = `${JSON.stringify(event)}\n`;
    for (const c of this.#clients) c.write(line);
  }

  listSessions(): MeshAgentSession[] {
    return [...this.#sessions.values()];
  }

  log(): MeshBroadcastEvent[] {
    return [...this.#log];
  }

  on(_event: string, _cb: (e: MeshBroadcastEvent) => void): void {}

  async connect(
    agentId: string,
    workspaceKey: string,
  ): Promise<{ on: (ev: string, cb: (e: unknown) => void) => void; destroy: () => void }> {
    const sock = meshSocketPath(this.#storeRoot);
    const cbs = new Map<string, ((e: unknown) => void)[]>();
    const fallback = {
      on: (ev: string, cb: (e: unknown) => void) => {
        const a = cbs.get(ev) ?? [];
        a.push(cb);
        cbs.set(ev, a);
      },
      destroy: () => {
        try {
          conn.destroy();
        } catch {}
      },
    };
    const conn = createConnection(sock);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          conn.destroy();
        } catch {}
      }
    }, 200);

    await new Promise<void>((resolve) => {
      conn.on("connect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          conn.write(`${JSON.stringify({ agentId, workspaceKey })}\n`);
        } catch {}
        resolve();
      });
      conn.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
    });

    conn.on("data", (chunk) => {
      const lines = chunk.toString("utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const ev = JSON.parse(line) as unknown;
          for (const cb of cbs.get("event") ?? []) cb(ev);
        } catch {}
      }
    });
    conn.on("error", () => {});

    return fallback;
  }
}

export { meshSocketPath } from "./paths.js";
