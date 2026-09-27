/**
 * BytesJev MCP server over stdio. Launched by Claude Code (see .mcp.json).
 *
 * stdout is the protocol channel, so every log line goes to stderr. The API
 * key is read from TYPESAFE_API_KEY (or .env) and never printed. No cache and
 * no logs are persisted unless BYTESJEV_CACHE=1 is set explicitly.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "../config.js";
import { createJev } from "../jev/client.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const log = (line: string): void => {
  if (process.env.BYTESJEV_DEBUG === "1") process.stderr.write(`[${SERVER_NAME}] ${line}\n`);
};

const jev = config.jev.apiKey
  ? createJev({
      apiKey: config.jev.apiKey,
      model: config.jev.model,
      timeoutMs: Number(process.env.BYTESJEV_TIMEOUT_MS || 20_000),
      cacheDir: process.env.BYTESJEV_CACHE === "1" ? config.jev.cacheDir : undefined,
    })
  : null;

if (!jev) process.stderr.write(`[${SERVER_NAME}] TYPESAFE_API_KEY is not set; PlanningChecker will answer "unavailable"\n`);

const server = createServer({ jev, log });
await server.connect(new StdioServerTransport());
log(`v${SERVER_VERSION} ready on stdio (model ${config.jev.model})`);
