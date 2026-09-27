/**
 * Local dashboard: shows every PlanningChecker call as it happens. `npm run
 * viz`, open the printed URL, then call the tool from Claude Code. The MCP
 * server posts each call here (POST /relay); the page can also run the
 * bundled example itself (POST /run) so there is something to look at
 * without Claude Code.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { EXAMPLE } from "../example.js";
import { createJev } from "../jev/client.js";
import { checkPlan } from "../mcp/planning-checker.js";
import { narrate, type Message } from "./messages.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.VIZ_PORT || 4310);
const KEEP_CALLS = 20;

const clients = new Set<ServerResponse>();
/** messages of the most recent calls, so a page that opens late sees them */
let history: Message[] = [];
const setup = { model: config.jev.model };

function broadcast(msg: Message): void {
  if (msg.type !== "hello") {
    history.push(msg);
    const ids = [...new Set(history.map((m) => (m.type === "hello" ? "" : m.id)))];
    if (ids.length > KEEP_CALLS) {
      const drop = new Set(ids.slice(0, ids.length - KEEP_CALLS));
      history = history.filter((m) => m.type === "hello" || !drop.has(m.id));
    }
  }
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

const jev = config.jev.apiKey ? createJev({ apiKey: config.jev.apiKey, model: config.jev.model, timeoutMs: 20_000 }) : null;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(join(here, "index.html")));
    return;
  }
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello", setup } satisfies Message)}\n\n`);
    for (const msg of history) res.write(`data: ${JSON.stringify(msg)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }
  // The MCP server narrates its calls here, one message per request, in order.
  if (req.method === "POST" && url.pathname === "/relay") {
    let msg: Message | null = null;
    try {
      msg = JSON.parse((await readBody(req)) || "null") as Message | null;
    } catch {
      msg = null;
    }
    if (!msg || typeof msg.type !== "string" || msg.type === "hello") return json(res, 400, { error: "Expected a call, item, or done message." });
    broadcast(msg);
    return json(res, 202, { ok: true });
  }
  // Run a check from the page: the bundled example, or a body shaped like the tool's input.
  if (req.method === "POST" && url.pathname === "/run") {
    const raw = (await readBody(req)).trim();
    const input = raw ? (JSON.parse(raw) as unknown) : EXAMPLE;
    void checkPlan(input, { jev, observe: narrate(broadcast, { source: "page" }) });
    return json(res, 202, { ok: true });
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`BytesJev PlanningChecker dashboard  →  http://localhost:${PORT}`);
  console.log(jev ? `jev=${config.jev.model}` : "TYPESAFE_API_KEY is not set: relayed calls will show, the page's own Run will answer unavailable");
  console.log("calls from Claude Code (the MCP server) stream here automatically; press ⌘M on the page for the 9:16 view");
});
