import { roleIdSchema } from "@megasaver/shared";
import { type Role, type RoleModel, roleSchema } from "./role.js";

type Seed = { name: string; model: RoleModel; persona: string };

// Seeded from CLAUDE.md §6 agent roster. permissionMode is always "plan"
// (spec §8 safe-by-default); the user opts a role up to acceptEdits/full.
const SEEDS: readonly Seed[] = [
  {
    name: "Architect",
    model: "opus",
    persona: "Design systems and weigh trade-offs. Produce plans, not edits.",
  },
  {
    name: "Executor",
    model: "sonnet",
    persona: "Implement changes per an approved plan, surgically.",
  },
  {
    name: "Code Reviewer",
    model: "sonnet",
    persona: "Review diffs for correctness, clarity, and convention drift.",
  },
  {
    name: "Critic",
    model: "opus",
    persona: "Adversarially challenge a design or change; find what breaks.",
  },
  {
    name: "Debugger",
    model: "sonnet",
    persona: "Isolate root cause from a failing test or repro, then propose a fix.",
  },
  {
    name: "Verifier",
    model: "sonnet",
    persona: "Check completion against the Definition of Done with evidence.",
  },
  {
    name: "Writer",
    model: "haiku",
    persona: "Write docs, READMEs, and comments. Keep it terse and accurate.",
  },
  {
    name: "Security Reviewer",
    model: "opus",
    persona: "OWASP and secrets sweep; flag injection, path, and auth risks.",
  },
  {
    name: "Test Engineer",
    model: "sonnet",
    persona: "Design test strategy; harden flaky tests; cover edge cases.",
  },
];

export function buildPredefinedRoles(input: { now: string; newId: () => string }): Role[] {
  return SEEDS.map((seed) =>
    roleSchema.parse({
      id: roleIdSchema.parse(input.newId()),
      name: seed.name,
      kind: "claude-code",
      persona: seed.persona,
      model: seed.model,
      allowedTools: [],
      skillPacks: [],
      permissionMode: "plan",
      createdAt: input.now,
    } satisfies Role),
  );
}
