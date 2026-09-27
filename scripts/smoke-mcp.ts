/**
 * Drives the stdio MCP server the way Claude Code does: spawn it, list tools,
 * call PlanningChecker once, and print the structured result.
 *   npm run smoke:mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke-mcp", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp/index.ts"], stderr: "inherit" }));

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name));

const result = await client.callTool({
  name: "PlanningChecker",
  arguments: {
    user_request: "Add a Copy link button to the article page.",
    repo_context: "Article actions live in ArticleActions.tsx; an existing clipboard utility is available.",
    plan_items: [
      { id: "p1", change: "Add the button and copy the current URL", rationale: "Directly requested" },
      { id: "p2", change: "Create a generic action registry", rationale: "Could support future actions" },
    ],
  },
});
console.log(JSON.stringify(result.structuredContent, null, 2));

const bad = await client.callTool({ name: "PlanningChecker", arguments: { user_request: "x", plan_items: [{ id: "a", change: "c" }, { id: "a", change: "d" }] } });
console.log("duplicate ids →", (bad.structuredContent as { status: string; errors?: string[] }).status, (bad.structuredContent as { errors?: string[] }).errors);

await client.close();
