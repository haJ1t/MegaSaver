import { z } from "zod";

// Order: alphabetic per AA3 (epic §17). Closed enum — adding a
// member is a spec change. intent_missing and path_denied have no
// producer inside this package (epic §9a §2a/§4b); they are pinned
// for the downstream BB7a/BB8 orchestrator that maps gate failures.
export const policyDenyCodeSchema = z.enum([
  "command_not_allowed",
  "dangerous_pattern",
  "intent_missing",
  "path_denied",
  "recursive_megasaver",
  "secret_path_read",
]);

export type PolicyDenyCode = z.infer<typeof policyDenyCodeSchema>;
