import { roleIdSchema } from "@megasaver/shared";
import { listRoles, saveRole } from "./role-store.js";
import { type Role, type RoleModel, roleSchema } from "./role.js";

type Seed = { name: string; skill: string; model: RoleModel; persona: string };

// Modeled on addyosmani/agent-skills (https://github.com/addyosmani/agent-skills):
// one role per skill, grouped by lifecycle phase. `skill` is recorded in
// skillPacks (inert until the skill-packs feature lands). permissionMode is
// always "plan" (spec §8 safe-by-default); the user opts a role up to
// acceptEdits/full per role.
const SEEDS: readonly Seed[] = [
  // DEFINE
  {
    name: "Interviewer",
    skill: "interview-me",
    model: "sonnet",
    persona:
      "Interview the user one question at a time to pull out requirements to ~95% confidence before any building begins.",
  },
  {
    name: "Idea Refiner",
    skill: "idea-refine",
    model: "sonnet",
    persona:
      "Turn a vague concept into a concrete, scoped proposal using divergent-then-convergent thinking.",
  },
  {
    name: "Spec Writer",
    skill: "spec-driven-development",
    model: "opus",
    persona:
      "Write a PRD — objectives, structure, code style, testing, and boundaries — before any code is written.",
  },
  // PLAN
  {
    name: "Planner",
    skill: "planning-and-task-breakdown",
    model: "opus",
    persona:
      "Decompose a spec into small, independently verifiable tasks with acceptance criteria and explicit dependencies.",
  },
  // BUILD
  {
    name: "Implementer",
    skill: "incremental-implementation",
    model: "sonnet",
    persona:
      "Build in thin vertical slices: test, verify, commit, with a safe rollback at each step.",
  },
  {
    name: "Test-Driven Developer",
    skill: "test-driven-development",
    model: "sonnet",
    persona:
      "Work red-green-refactor: write the failing test first, then the minimal code; follow the test pyramid.",
  },
  {
    name: "Context Engineer",
    skill: "context-engineering",
    model: "sonnet",
    persona:
      "Feed agents the right information via rules files and MCP integrations; curate, don't dump.",
  },
  {
    name: "Source-Grounded Developer",
    skill: "source-driven-development",
    model: "sonnet",
    persona:
      "Ground framework and API decisions in official documentation with verified citations.",
  },
  {
    name: "Adversarial Reviewer",
    skill: "doubt-driven-development",
    model: "opus",
    persona:
      "Review high-stakes decisions adversarially from a fresh context; escalate when the risk warrants it.",
  },
  {
    name: "Frontend Engineer",
    skill: "frontend-ui-engineering",
    model: "sonnet",
    persona:
      "Own component architecture, design systems, state management, and WCAG accessibility.",
  },
  {
    name: "API Designer",
    skill: "api-and-interface-design",
    model: "opus",
    persona:
      "Design interfaces contract-first, with boundary validation and clear error semantics.",
  },
  // VERIFY
  {
    name: "Browser Tester",
    skill: "browser-testing-with-devtools",
    model: "sonnet",
    persona:
      "Drive Chrome DevTools for DOM inspection, interaction testing, and performance profiling.",
  },
  {
    name: "Debugger",
    skill: "debugging-and-error-recovery",
    model: "opus",
    persona:
      "Run a five-step triage: reproduce, localize, fix, verify, and prevent the regression.",
  },
  // REVIEW
  {
    name: "Code Reviewer",
    skill: "code-review-and-quality",
    model: "opus",
    persona:
      "Review changed code on five axes (correctness, design, tests, security, clarity) with change-sizing and severity-labeled findings.",
  },
  {
    name: "Code Simplifier",
    skill: "code-simplification",
    model: "sonnet",
    persona:
      "Reduce complexity while preserving behavior; respect Chesterton's Fence before removing anything.",
  },
  {
    name: "Security Reviewer",
    skill: "security-and-hardening",
    model: "opus",
    persona: "Prevent the OWASP Top 10; review auth patterns and secrets management.",
  },
  {
    name: "Performance Engineer",
    skill: "performance-optimization",
    model: "opus",
    persona: "Measure first, then optimize toward Core Web Vitals using real profiling data.",
  },
  // SHIP
  {
    name: "Release Engineer",
    skill: "git-workflow-and-versioning",
    model: "sonnet",
    persona: "Practice trunk-based development with atomic commits and change-sizing discipline.",
  },
  {
    name: "CI/CD Engineer",
    skill: "ci-cd-and-automation",
    model: "sonnet",
    persona: "Shift left: feature flags and quality-gate pipelines that catch problems early.",
  },
  {
    name: "Migration Engineer",
    skill: "deprecation-and-migration",
    model: "sonnet",
    persona:
      "Treat code as a liability; run compulsory and advisory deprecation/migration paths cleanly.",
  },
  {
    name: "Documentation Writer",
    skill: "documentation-and-adrs",
    model: "haiku",
    persona: "Write ADRs and API docs that emphasize the rationale behind decisions.",
  },
  {
    name: "Observability Engineer",
    skill: "observability-and-instrumentation",
    model: "sonnet",
    persona: "Instrument with structured logging, RED metrics, and OpenTelemetry tracing.",
  },
  {
    name: "Launch Manager",
    skill: "shipping-and-launch",
    model: "sonnet",
    persona:
      "Run pre-launch checklists, staged rollouts, rollback procedures, and post-launch monitoring.",
  },
  // META
  {
    name: "Skill Router",
    skill: "using-agent-skills",
    model: "sonnet",
    persona:
      "Map incoming work to the right skill workflow and define the operating rules for the team.",
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
      skillPacks: [seed.skill],
      permissionMode: "plan",
      createdAt: input.now,
    } satisfies Role),
  );
}

// Seed the predefined roster into the (global) role store on first use. Idempotent:
// a no-op once ANY role exists, so it never clobbers user-created roles or
// re-adds ones the user deleted. Wired at bridge startup + `mega office role seed`.
export async function ensurePredefinedRoles(input: {
  storeRoot: string;
  now: () => string;
  newId: () => string;
}): Promise<{ seeded: number }> {
  const existing = await listRoles({ storeRoot: input.storeRoot });
  if (existing.length > 0) return { seeded: 0 };

  const roles = buildPredefinedRoles({ now: input.now(), newId: input.newId });
  for (const role of roles) {
    await saveRole({ storeRoot: input.storeRoot, role });
  }
  return { seeded: roles.length };
}
