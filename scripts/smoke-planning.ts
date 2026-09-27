/**
 * Live PlanningChecker run against Jev with the PRD's copy-link example.
 *   npm run smoke:plan
 */
import { config } from "../src/config.js";
import { EXAMPLE } from "../src/example.js";
import { createJev } from "../src/jev/client.js";
import { checkPlan } from "../src/mcp/planning-checker.js";

if (!config.jev.apiKey) {
  console.error("TYPESAFE_API_KEY is not set");
  process.exit(2);
}
const jev = createJev({ apiKey: config.jev.apiKey, model: config.jev.model, cacheDir: config.jev.cacheDir });

const out = await checkPlan(EXAMPLE, { jev });

console.log(JSON.stringify(out, null, 2));
console.error(jev.usage.summary());
