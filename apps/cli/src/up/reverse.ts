import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeCodeHookResult } from "@megasaver/connector-claude-code";
import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "@megasaver/connectors-shared";
import type { TokenSaverMode } from "@megasaver/shared";
import { type UpManifest, writeUpManifest } from "./manifest.js";

export type DownDeps = {
  hooksUninstall: () => ClaudeCodeHookResult;
  saverRestore: (enabled: boolean, mode: TokenSaverMode, exact: boolean) => void;
  now: () => string;
};

export function stripSentinelBlock(content: string): { next: string; removed: boolean } {
  const start = content.indexOf(MEGA_SAVER_BLOCK_START);
  const endAt = content.indexOf(MEGA_SAVER_BLOCK_END);
  if (start === -1 || endAt === -1 || endAt < start) return { next: content, removed: false };
  const end = endAt + MEGA_SAVER_BLOCK_END.length;
  const next = (content.slice(0, start) + content.slice(end)).replace(/\n{3,}/g, "\n\n");
  return { next, removed: true };
}

export function runDownReverse(input: {
  manifest: UpManifest;
  storeRoot: string;
  cwd: string;
  deps: DownDeps;
}): { code: 0 | 1; lines: string[] } {
  const lines: string[] = [];
  const reversedSteps = [...input.manifest.steps].reverse();

  for (const step of reversedSteps) {
    switch (step.kind) {
      case "saver-enable": {
        input.deps.saverRestore(step.priorEnabled, step.priorMode, step.exact);
        lines.push(
          `saver:     restored prior activation (enabled: ${step.priorEnabled}, mode: ${step.priorMode})`,
        );
        break;
      }
      case "connector-sync": {
        if (step.projectCreated) {
          lines.push(`project:   kept "${step.projectName}" in store (store data)`);
        }
        for (const target of step.targets) {
          const absPath = join(input.cwd, target.relativePath);
          if (!existsSync(absPath)) continue;

          if (target.prior === "block") {
            lines.push(`connector: kept ${target.relativePath} (prior block preserved)`);
            continue;
          }

          const existing = readFileSync(absPath, "utf8");
          const stripped = stripSentinelBlock(existing);

          if (target.prior === "missing") {
            if (stripped.next.trim().length === 0) {
              unlinkSync(absPath);
              lines.push(`connector: removed ${target.relativePath} (created by up, now empty)`);
            } else {
              writeFileSync(absPath, stripped.next);
              lines.push(`connector: stripped block from ${target.relativePath}`);
            }
          } else if (target.prior === "no-block") {
            writeFileSync(absPath, stripped.next);
            lines.push(`connector: stripped block from ${target.relativePath}`);
          }
        }
        break;
      }
      case "hooks-install": {
        if (!step.priorConnected) {
          const res = input.deps.hooksUninstall();
          lines.push(`hooks:     uninstalled from ${step.settingsPath} (changed: ${res.changed})`);
        } else {
          lines.push(`hooks:     preserved pre-existing hooks in ${step.settingsPath}`);
        }
        break;
      }
    }
  }

  const updatedManifest: UpManifest = {
    ...input.manifest,
    updatedAt: input.deps.now(),
    reversedAt: input.deps.now(),
  };

  writeUpManifest(input.storeRoot, updatedManifest);

  return { code: 0, lines };
}
