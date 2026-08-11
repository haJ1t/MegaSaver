import { defineCommand } from "citty";

export const promptCommand = defineCommand({
  meta: { name: "prompt", description: "Prompt diet coach (advisory, never blocks)." },
  subCommands: {
    diet: defineCommand({
      meta: { name: "diet", description: "Replay diet heuristics on a prompt (offline)." },
      args: {
        prompt: { type: "positional", required: true, description: "Prompt to analyze." },
        json: { type: "boolean", default: false, description: "Emit JSON." },
      },
      async run({ args }) {
        console.log(`prompt diet: "${args.prompt}" (stub — 5 heuristics, see spec)`);
      },
    }),
    coach: defineCommand({
      meta: { name: "coach", description: "Toggle prompt coach (store/config/prompt-coach.json)." },
      args: {
        action: { type: "positional", required: false, description: "on|off|threshold" },
        value: { type: "positional", required: false, description: "threshold value" },
      },
      async run({ args }) {
        console.log(`prompt coach ${args.action ?? ""} ${args.value ?? ""} (stub)`);
      },
    }),
  },
});
