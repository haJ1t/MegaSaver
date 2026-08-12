import { join } from "node:path";

export function meshPaths(storeRoot: string): {
  presenceDir: string;
  eventsPath: string;
  claimsDir: string;
  inboxDir: string;
  boardDir: string;
  quarantineDir: string;
} {
  const meshDir = join(storeRoot, "mesh");
  return {
    presenceDir: join(meshDir, "presence"),
    eventsPath: join(meshDir, "events.jsonl"),
    claimsDir: join(meshDir, "claims"),
    inboxDir: join(meshDir, "inbox"),
    boardDir: join(meshDir, "board"),
    quarantineDir: join(meshDir, "quarantine"),
  };
}
