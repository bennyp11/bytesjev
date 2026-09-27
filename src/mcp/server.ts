import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Jev } from "../jev/client.js";
import { checkPlan, LIMITS, planItemSchema } from "./planning-checker.js";

export const SERVER_NAME = "bytesjev";
export const SERVER_VERSION = "0.1.0";

const itemResultSchema = z.object({
  id: z.string(),
  necessity_score: z.number(),
  recommendation: z.enum(["keep", "simplify", "review"]),
  reason: z.string(),
  evidence: z.array(z.string()),
  uncertain: z.boolean(),
});

const outputSchema = {
  status: z.enum(["ok", "unavailable", "invalid"]),
  results: z.array(itemResultSchema),
  limitations: z.array(z.string()),
  error: z.string().optional(),
  errors: z.array(z.string()).optional(),
};

const TOOL_DESCRIPTION = `Advisory check for overengineering. Call it once after you have a plan and before you edit any file.

Send the user's ORIGINAL request verbatim (never reconstruct it), every meaningful proposed addition as its own plan item with your honest rationale, and the repository conventions or constraints that bear on those items. Do not send secrets, .env contents, or unrelated source: the payload is transmitted to the Jev API.

Each item comes back with a necessity_score (Jev's support for the specific question "is this needed by the request, a stated constraint, or correctness/security"; not a verified probability), a recommendation (keep / simplify / review), a reason that cites your submitted text, and an uncertain flag. "simplify" is only given when the other plan items alone would satisfy the request. "review" means the evidence is mixed or missing: decide yourself and name the concrete need if you keep the item. On status "unavailable" proceed with your plan as normal.

Limits: ${LIMITS.maxItems} items, ${LIMITS.requestChars} chars of request, ${LIMITS.contextChars} chars of context; truncation is reported in limitations.`;

export interface ServerDeps {
  jev: Jev | null;
  /** stderr logger; never receives the request body or the API key */
  log?: (line: string) => void;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const log = deps.log ?? (() => {});

  server.registerTool(
    "PlanningChecker",
    {
      title: "Planning Checker",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        user_request: z.string().describe("The user's original request, verbatim."),
        repo_context: z.string().optional().describe("Existing conventions, utilities, or constraints relevant to the plan items. Facts you observed in the repository, not guesses."),
        plan_items: z.array(planItemSchema).min(1).max(LIMITS.maxItems).describe("Each meaningful proposed addition with a stable id and your rationale."),
      },
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args) => {
      const started = Date.now();
      const out = await checkPlan(args, { jev: deps.jev });
      log(`PlanningChecker ${out.status} items=${args.plan_items.length} ms=${Date.now() - started}${out.status === "unavailable" ? ` error=${out.error}` : ""}`);
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        structuredContent: out,
        isError: out.status === "invalid",
      };
    },
  );

  return server;
}
