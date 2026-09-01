import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RouteContext } from "../route-context.js";
const execFileAsync = promisify(execFile);

/**
 * POST /api/fs/pick-folder
 * Opens the OS native folder picker on the machine running the bridge.
 * Works in plain browser mode (`mega gui`) where the renderer cannot call
 * Electron or get an absolute path. The bridge runs on the same machine, so
 * it can open the dialog locally.
 *
 * macOS: uses `osascript` (Finder dialog) — no extra deps, always available.
 * Other platforms: best-effort (zenity on Linux, PowerShell on Windows);
 * absent tooling → 501 with guidance to paste manually.
 *
 * Response: { path: string | null }  (null = cancelled)
 * Loopback-only + token-guarded (like all /api/*).
 */
export async function handlePickFolder(ctx: RouteContext): Promise<void> {
  const platform = process.platform;
  try {
    let picked: string | null = null;
    if (platform === "darwin") {
      try {
        const { stdout } = await execFileAsync(
          "osascript",
          ["-e", 'POSIX path of (choose folder with prompt "Select project folder")'],
          { timeout: 2 * 60_000 },
        );
        picked = stdout.trim() || null;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // User cancelled: osascript exits with "User canceled." (-128)
        if (/User canceled/i.test(msg) || /-128/.test(msg)) {
          ctx.sendJson(ctx.res, 200, { path: null }, ctx.origin);
          return;
        }
        throw e;
      }
    } else if (platform === "linux") {
      try {
        const { stdout } = await execFileAsync(
          "zenity",
          ["--file-selection", "--directory", "--title=Select project folder"],
          { timeout: 2 * 60_000 },
        );
        picked = stdout.trim() || null;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // zenity exits non-zero on cancel; detect cancel vs missing tool
        if (/No such file/i.test(msg) || /ENOENT/i.test(msg)) {
          ctx.sendError(
            ctx.res,
            501,
            "internal_error",
            "Native folder picker not available on this system. Please paste the path.",
            ctx.origin,
          );
          return;
        }
        // cancel on zenity is exit 1 with empty stdout → treat as null
        const anyE = e as { stdout?: string; code?: number };
        if (anyE.code === 1 && !anyE.stdout) {
          ctx.sendJson(ctx.res, 200, { path: null }, ctx.origin);
          return;
        }
        throw e;
      }
    } else if (platform === "win32") {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select project folder'; $d.ShowNewFolderButton = $false; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`;
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", ps], {
        timeout: 2 * 60_000,
      });
      picked = stdout.trim() || null;
    } else {
      ctx.sendError(
        ctx.res,
        501,
        "internal_error",
        "Native folder picker not supported on this platform. Please paste the path.",
        ctx.origin,
      );
      return;
    }
    if (picked !== null) {
      // osascript appends trailing slash; normalize to no-trailing-slash
      picked = picked.replace(/\/+$/, "");
      if (picked.length === 0) picked = null;
    }
    ctx.sendJson(ctx.res, 200, { path: picked }, ctx.origin);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.sendError(ctx.res, 500, "internal_error", msg, ctx.origin);
  }
}
