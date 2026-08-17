import type { CommitInfo } from "./git.js";
import type { ReceiptCandidate } from "./receipts.js";

export type ReceiptRow = {
  scope: string;
  command: string;
  exitCode?: number | null;
  createdAt: string;
  chunkSetId?: string;
};

export type ClaimsManifest = {
  claims: CommitInfo[];
  packagesTouched: string[];
  receipts: ReceiptRow[];
  gaps: string[];
  warnings: string[];
};

export function packagesForFiles(paths: readonly string[]): string[] {
  const scopes = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    if ((parts[0] === "packages" || parts[0] === "apps") && parts[1]) {
      scopes.add(`${parts[0]}/${parts[1]}`);
    } else {
      scopes.add("repo");
    }
  }
  return [...scopes].sort();
}

function resolveScopeForCommand(command: string): string {
  // Check packages/<name> and apps/<name> filter patterns
  const filterMatch = /--filter\s+(@megasaver\/)?([a-z0-9-]+)/i.exec(command);
  if (filterMatch?.[2]) {
    const name = filterMatch[2];
    // If it's a known CLI or GUI app, scope is apps/<name>, else packages/<name>
    if (name === "cli" || name === "gui") {
      return `apps/${name}`;
    }
    return `packages/${name}`;
  }
  return "repo";
}

export function buildClaimsManifest(input: {
  commits: readonly CommitInfo[];
  changedPaths: readonly string[];
  receipts: readonly ReceiptCandidate[];
}): ClaimsManifest {
  const packagesTouched = packagesForFiles(input.changedPaths);
  const byScope = new Map<string, ReceiptRow>();

  for (const r of input.receipts) {
    const scope = resolveScopeForCommand(r.command);
    const existing = byScope.get(scope);
    const time = Date.parse(r.createdAt);
    const existingTime = existing ? Date.parse(existing.createdAt) : -Infinity;

    if (!existing || time >= existingTime) {
      byScope.set(scope, {
        scope,
        command: r.command,
        ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
        createdAt: r.createdAt,
        ...(r.chunkSetId !== undefined ? { chunkSetId: r.chunkSetId } : {}),
      });
    }
  }

  const receipts = [...byScope.values()].sort((a, b) => a.scope.localeCompare(b.scope));
  const gaps = packagesTouched.filter((scope) => !byScope.has(scope));
  const warnings: string[] = [];

  if (gaps.length > 0) {
    warnings.push(`missing test receipts for touched scopes: ${gaps.join(", ")}`);
  }

  return {
    claims: [...input.commits],
    packagesTouched,
    receipts,
    gaps,
    warnings,
  };
}
