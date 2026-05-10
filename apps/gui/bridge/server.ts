import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import {
  type MemoryEntry,
  type Session,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";
import { resolveBridgeStorePath } from "./store-path.js";

const DEFAULT_PORT = 5174;

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

async function main(): Promise<void> {
  const storeDir = resolveBridgeStorePath({
    storeOverride: readEnv("MEGASAVER_GUI_STORE"),
    home: readEnv("HOME"),
    xdgDataHome: readEnv("XDG_DATA_HOME"),
  });

  await initStore(storeDir);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: storeDir });

  const routes: Record<string, Handler> = {
    "GET /api/health": (_req, res) => {
      sendJson(res, 200, { ok: true, store: storeDir });
    },
    "GET /api/sessions": (_req, res) => {
      const projects = registry.listProjects();
      const sessions: Session[] = projects.flatMap((project) => registry.listSessions(project.id));
      sendJson(res, 200, sessions);
    },
    "GET /api/memory": (_req, res) => {
      const projects = registry.listProjects();
      const entries: MemoryEntry[] = projects.flatMap((project) =>
        registry.listMemoryEntries(project.id),
      );
      sendJson(res, 200, entries);
    },
  };

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const key = `${method} ${url.split("?")[0] ?? url}`;
    const handler = routes[key];
    if (!handler) {
      sendJson(res, 404, { error: "not_found", route: key });
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: "internal", message });
    }
  });

  const portRaw = readEnv("MEGASAVER_GUI_BRIDGE_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : DEFAULT_PORT;
  server.listen(port, () => {
    process.stdout.write(`mega-saver bridge listening on http://localhost:${port}\n`);
    process.stdout.write(`store: ${storeDir}\n`);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`bridge failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
