import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("rejects a symlink inside distDir that points to an out-of-tree file", async () => {
    // A symlink lexically inside distDir but whose target is outside must not be
    // served — a lexical-only boundary check passes it, the realpath guard blocks it.
    const outside = mkdtempSync(join(tmpdir(), "megasaver-gui-secret-"));
    const secretFile = join(outside, "secret.js");
    const marker = "SYMLINK_LEAK_MARKER_5f3a9c";
    writeFileSync(secretFile, `console.log('${marker}');`);
    symlinkSync(secretFile, join(distDir, "leak.js"));
    try {
      h = await startHandler({ distDir });
      const res = await fetch(`${h.baseUrl}/leak.js`, { redirect: "manual" });
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain(marker);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked directory inside distDir that points out of tree", async () => {
    const outside = mkdtempSync(join(tmpdir(), "megasaver-gui-secretdir-"));
    const marker = "SYMLINK_DIR_LEAK_MARKER_a17b2e";
    writeFileSync(join(outside, "secret.js"), `console.log('${marker}');`);
    symlinkSync(outside, join(distDir, "leakdir"));
    try {
      h = await startHandler({ distDir });
      const res = await fetch(`${h.baseUrl}/leakdir/secret.js`, { redirect: "manual" });
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain(marker);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("still serves a real in-tree file after the realpath guard (index.html)", async () => {
    // Guard sanity: a genuine file whose realpath stays inside distDir must 200.
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>gui</title>");
    const asset = await fetch(`${h.baseUrl}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("console.log");
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

  it("never serves an /api path as a static file (static is consulted after /api routing)", async () => {
    // Regression guard: even if distDir contains a file that collides with an
    // /api path, /api/* must route (health JSON here), never fall to serveStatic.
    // Mutation intent: moving serveStatic before /api dispatch fails this test.
    mkdirSync(join(distDir, "api"), { recursive: true });
    writeFileSync(join(distDir, "api", "health"), "STATIC_SHADOW_MARKER_should_not_leak");
    h = await startHandler({ distDir });
    const res = await fetch(`${h.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("STATIC_SHADOW_MARKER_should_not_leak");
    expect(res.headers.get("content-type")).toContain("application/json");
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({ ok: true });
  });
});
