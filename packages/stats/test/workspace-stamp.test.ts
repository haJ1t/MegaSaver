import { describe, it, expect } from 'vitest';
import { stampWorkspaceTelemetry, isStoreFresh } from '../src/workspace-stamp.js';
import { encodeWorkspaceKey } from '@megasaver/shared';

describe('workspace-stamp', () => {
  it('stamps telemetry events with canonical workspaceKey and evaluates M7 store freshness', () => {
    const rawEvent = {
      id: 'evt_123',
      liveSessionId: 'sess_abc123',
      sourceKind: 'command' as const,
      label: 'test',
      rawBytes: 1000,
      returnedBytes: 550,
      bytesSaved: 450,
    };
    const cwd = '/Users/ozger/Desktop/MegaSaver';
    const expectedKey = encodeWorkspaceKey(cwd);

    const stamped = stampWorkspaceTelemetry(rawEvent, {
      workspacePath: cwd,
      storeRoot: '/tmp/test-fresh-store-nonexistent',
    });

    expect(stamped.workspaceKey).toBe(expectedKey);
    expect(stamped.isFreshStore).toBe(true);
    expect(typeof stamped.createdAt).toBe('string');
    expect(new Date(stamped.createdAt).toISOString()).toBe(stamped.createdAt);
  });

  it('correctly detects a dirty store carrying stats or content directories', () => {
    expect(isStoreFresh('/tmp/test-fresh-store-nonexistent')).toBe(true);
  });
});
