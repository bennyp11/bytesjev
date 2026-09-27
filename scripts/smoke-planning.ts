/**
 * Live PlanningChecker run against Jev with the PRD's copy-link example.
 *   npm run smoke:plan
 */
import { config } from "../src/config.js";
import { createJev } from "../src/jev/client.js";
import { checkPlan } from "../src/mcp/planning-checker.js";

if (!config.jev.apiKey) {
  console.error("TYPESAFE_API_KEY is not set");
  process.exit(2);
}
const jev = createJev({ apiKey: config.jev.apiKey, model: config.jev.model, cacheDir: config.jev.cacheDir });

const out = await checkPlan(
  {
    user_request: "Add a Copy link button to the article page.",
    repo_context:
      "Article actions live in src/components/ArticleActions.tsx as plain buttons. A shared clipboard helper exists at src/lib/clipboard.ts and is already used by the share menu. No plugin or registry pattern exists for actions. Config is a single src/config.ts with a handful of constants.",
    plan_items: [
      { id: "p1", change: "Add a Copy link button to ArticleActions.tsx that copies the current URL", rationale: "Directly requested" },
      { id: "p2", change: "Create a generic action registry so actions can be registered from anywhere", rationale: "Could support future actions" },
      { id: "p3", change: "Add a copy-to-clipboard npm dependency", rationale: "Handles browser differences" },
      { id: "p4", change: "Add a global config flag to enable or disable the copy-link feature", rationale: "Lets teams turn it off" },
      { id: "p5", change: "Use the existing src/lib/clipboard.ts helper for the copy", rationale: "The repo already uses it for the share menu" },
      { id: "p6", change: "Show a short 'Copied' confirmation after the click", rationale: "The user gets no feedback otherwise" },
    ],
  },
  { jev },
);

console.log(JSON.stringify(out, null, 2));
console.error(jev.usage.summary());
