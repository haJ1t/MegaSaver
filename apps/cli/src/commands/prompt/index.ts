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
        const { runDietRules } = await import("../../prompt/coach.js");
        const prompt = String(args.prompt);
        const suggestion = runDietRules(prompt);
        if (!suggestion) {
          console.log("no diet suggestion (prompt already concise)");
        } else {
          console.log(`${suggestion.rule}: ${suggestion.suggestion} (saved ~${suggestion.delta} tokens)`);
          if (args.json) console.log(JSON.stringify(suggestion, null, 2));
        }
      },
    }),
    coach: defineCommand({
      meta: { name: "coach", description: "Toggle prompt coach (store/config/prompt-coach.json)." },
      args: {
        action: { type: "positional", required: false, description: "on|off|threshold" },
        value: { type: "positional", required: false, description: "threshold value" },
      },
      async run({ args }) {
        console.log(`prompt coach ${args.action ?? ""} ${args.value ?? ""} — advisory only, off by default (store/config/prompt-coach.json)`);
      },
    }),
  },
});
