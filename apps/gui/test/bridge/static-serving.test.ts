import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

type Harness = { baseUrl: string; close: () => Promise<void> };

function seedDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "megasaver-gui-dist-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>gui</title>");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "app.js"), "console.log('app');");
  writeFileSync(join(dir, "assets", "app.css"), "body{color:#000}");
  return dir;
}

async function startHandler(opts: { distDir?: string; token?: string }): Promise<Harness> {
  const handler = createBridgeHandler({
    ...(opts.distDir !== undefined ? { distDir: opts.distDir } : {}),
    ...(opts.token !== undefined ? { token: opts.token } : {}),
  });
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("bridge static serving", () => {
  let distDir: string;
  let h: Harness;

  beforeEach(() => {
    distDir = seedDist();
  });
  afterEach(async () => {
    if (h) await h.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it("GET / → 200 text/html serving index.html", async () => {
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>gui</title>");
  });

  it("GET /assets/app.js → 200 javascript", async () => {
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("console.log");
  });

  it("GET /assets/app.css → 200 text/css", async () => {
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/assets/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("GET /nope.png (missing) → 404", async () => {
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/nope.png`);
    expect(res.status).toBe(404);
  });

  it("GET / with NO distDir configured → 404 (dev regression guard)", async () => {
    h = await startHandler({});
    const res = await fetch(`${h.baseUrl}/`);
    expect(res.status).toBe(404);
  });

  it("GET / is served WITHOUT a token even when the /api wall is armed", async () => {
    h = await startHandler({ distDir, token: "SECRET" });
    const res = await fetch(`${h.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("rejects ../ path traversal → not a file outside distDir", async () => {
    h = await startHandler({ distDir });
    // The bridge must not serve /etc/passwd via a dotdot escape.
    const res = await fetch(`${h.baseUrl}/../../../../etc/passwd`, { redirect: "manual" });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("root:");
  });

  it("rejects encoded ../ path traversal (%2e%2e) → blocked", async () => {
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd`, {
      redirect: "manual",
    });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("root:");
  });

  it("rejects an absolute-path escape → blocked", async () => {
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}//etc/passwd`, { redirect: "manual" });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("root:");
  });

  it("GET /assets/x.woff → 200 font/woff", async () => {
    writeFileSync(join(distDir, "assets", "font.woff"), "woff-bytes");
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/assets/font.woff`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/woff");
  });

  it("GET /assets/x.woff2 → 200 font/woff2", async () => {
    writeFileSync(join(distDir, "assets", "font.woff2"), "woff2-bytes");
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/assets/font.woff2`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/woff2");
  });
});
