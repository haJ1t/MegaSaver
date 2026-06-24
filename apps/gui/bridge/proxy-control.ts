import { randomUUID } from "node:crypto";
import { type RunningProxy, appendProxyUsage, startProxyServer } from "@megasaver/llm-proxy";
import { applyProxyEnv } from "./proxy-settings.js";

// ponytail: one bridge-process-wide proxy instance, managed by the GUI toggle.
// Single-developer, single-bridge — no need for a registry.
let running: RunningProxy | null = null;
let lastError: string | null = null;

const { MEGA_PROXY_PORT, MEGA_PROXY_UPSTREAM } = process.env;
const PARSED_PORT = Number.parseInt(MEGA_PROXY_PORT ?? "8787", 10);
const PORT = Number.isFinite(PARSED_PORT) ? PARSED_PORT : 8787; // allow 0 (random)
const UPSTREAM = MEGA_PROXY_UPSTREAM ?? "https://api.anthropic.com";

export type ProxyStatus = {
  running: boolean;
  url?: string;
  port?: number;
  error?: string;
};

export function proxyStatus(): ProxyStatus {
  if (running) return { running: true, url: running.url, port: running.port };
  return lastError ? { running: false, error: lastError } : { running: false };
}

export async function startProxy(storeRoot: string): Promise<ProxyStatus> {
  if (running) return proxyStatus();
  try {
    running = await startProxyServer({
      port: PORT,
      upstreamBaseUrl: UPSTREAM,
      onUsage: (event) => {
        void appendProxyUsage({ storeRoot, event }).catch(() => {});
      },
      newId: () => randomUUID(),
    });
    lastError = null;
    // Auto-route: new claude sessions + MegaSaver-spawned agents pick up the
    // proxy with no manual export.
    applyProxyEnv(running.url);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
  return proxyStatus();
}

export async function stopProxy(): Promise<ProxyStatus> {
  await running?.close();
  running = null;
  lastError = null;
  applyProxyEnv(null);
  return proxyStatus();
}

// Clear any ANTHROPIC_BASE_URL we left in local settings (bridge boot / shutdown)
// so a crashed-with-proxy-on bridge can't strand claude pointing at a dead port.
export function clearProxyEnv(): void {
  applyProxyEnv(null);
}
