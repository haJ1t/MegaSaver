import { defineCommand } from "citty";

export const forkCommand = defineCommand({
  meta: {
    name: "fork",
    description: "Conversation fork & time-travel (snapshot + resume via pending capsule).",
  },
  subCommands: {
    snapshot: defineCommand({
      meta: { name: "snapshot", description: "Write a fork point (preflight+ capsule+ intent)." },
      args: {
        label: { type: "string", description: "Optional label." },
        store: { type: "string", description: "Override store directory." },
      },
      async run({ args }) {
        const { buildForkPoint, renderForkCapsule } = await import("../../fork/model.js");
        const point = buildForkPoint({
          workspaceKey: "wk-demo",
          ...(args.label ? { label: String(args.label) } : {}),
          now: () => Date.now(),
          gitAvailable: true,
        });
        console.log(renderForkCapsule(point));
      },
    }),
    list: defineCommand({
      meta: { name: "list", description: "List fork points." },
      args: { json: { type: "boolean", default: false } },
      async run({ args }) {
        console.log(`fork list (stub)`);
        if (args.json) console.log(JSON.stringify([], null, 2));
      },
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show a fork point." },
      args: { id: { type: "positional", required: true } },
      async run({ args }) {
        console.log(`fork show ${args.id} (stub)`);
      },
    }),
    diff: defineCommand({
      meta: { name: "diff", description: "Diff two fork points." },
      args: {
        a: { type: "positional", required: true },
        b: { type: "positional", required: true },
      },
      async run({ args }) {
        console.log(`fork diff ${args.a} ${args.b} (stub)`);
      },
    }),
    resume: defineCommand({
      meta: { name: "resume", description: "Resume a fork via pending capsule (next session)." },
      args: {
        id: { type: "positional", required: true },
        next: { type: "boolean", default: false },
      },
      async run({ args }) {
        console.log(`fork resume ${args.id} next=${args.next} (stub — writes resume-capsule.json)`);
      },
    }),
  },
});
