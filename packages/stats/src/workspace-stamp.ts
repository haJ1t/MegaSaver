import { encodeWorkspaceKey, type WorkspaceKey } from '@megasaver/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface TelemetryOptions {
  workspacePath: string;
  storeRoot?: string;
  liveSessionId?: string;
}

export function isStoreFresh(storeRoot?: string): boolean {
  if (!storeRoot) return true;
  const statsDir = join(storeRoot, 'stats');
  const contentDir = join(storeRoot, 'content');
  return !existsSync(statsDir) && !existsSync(contentDir);
}

export function stampWorkspaceTelemetry<T extends Record<string, any>>(
  event: T,
  options: TelemetryOptions
) {
  const workspaceKey: WorkspaceKey = encodeWorkspaceKey(options.workspacePath);
  const fresh = isStoreFresh(options.storeRoot);

  return {
    ...event,
    workspaceKey,
    liveSessionId: options.liveSessionId ?? (event as any).liveSessionId ?? 'sess_default',
    isFreshStore: fresh,
    createdAt: new Date().toISOString(),
  };
}
