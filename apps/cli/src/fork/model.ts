import { z } from "zod";

export const forkPointSchema = z
  .object({
    version: z.literal(1),
    forkId: z.string().regex(/^\d+-[a-z0-9]{6}$/),
    createdAt: z.string().datetime({ offset: true }),
    label: z.string().optional(),
    workspaceKey: z.string().min(1),
    git: z.object({ available: z.boolean() }).passthrough(),
    preflightSnapshotId: z.string().nullable(),
    capsule: z.any().nullable(),
    intent: z.object({ prompt: z.string(), ts: z.number() }).nullable(),
    lineage: z.object({ storeRootHash: z.string(), indexHash: z.string() }).passthrough(),
  })
  .passthrough();

export type ForkPoint = z.infer<typeof forkPointSchema>;

export function buildForkPoint(input: {
  workspaceKey: string;
  label?: string;
  now: () => number;
  gitAvailable: boolean;
}): ForkPoint {
  const now = input.now();
  return {
    version: 1,
    forkId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(now).toISOString(),
    label: input.label,
    workspaceKey: input.workspaceKey,
    git: { available: input.gitAvailable },
    preflightSnapshotId: null,
    capsule: null,
    intent: null,
    lineage: { storeRootHash: "hash", indexHash: "hash" },
  };
}

export function renderForkCapsule(point: ForkPoint): string {
  return `# Fork ${point.forkId}\nlabel: ${point.label ?? "-"}\nworkspace: ${point.workspaceKey}\n`;
}

export function diffForkPoints(a: ForkPoint, b: ForkPoint): string {
  return `diff ${a.forkId} -> ${b.forkId}\nlabel: ${a.label ?? "-"} -> ${b.label ?? "-"}`;
}
