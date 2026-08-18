import type { FenceEntry } from "./fence-file.js";

export function fenceAlternative(entry: FenceEntry): string {
  if (entry.alternative !== undefined) return entry.alternative;
  switch (entry.class) {
    case "lockfile":
      return "edit the manifest and run the package manager (e.g. `pnpm install`) instead";
    case "build-output":
      return "edit the source and rebuild instead";
    case "codegen-header":
      return "edit the generator or template, then re-run codegen";
    case "linguist-generated":
      return "regenerate via the producing tool";
    case "vendored":
      return "patch upstream or re-vendor instead";
  }
}

export function formatFenceWarn(entry: FenceEntry, relPath: string): string {
  const alt = fenceAlternative(entry);
  return `[Mega Saver Generated-File Fence] Warning: editing '${relPath}' (${entry.class} — ${entry.reason}). Alternative: ${alt}. To allow editing, run: mega fence allow ${relPath}`;
}

export function formatFenceDenyReason(entry: FenceEntry, relPath: string): string {
  const alt = fenceAlternative(entry);
  return `[Mega Saver Generated-File Fence] Denied: editing '${relPath}' (${entry.class} — ${entry.reason}). Alternative: ${alt}. To allow editing, run: mega fence allow ${relPath}`;
}
