#!/usr/bin/env node
/**
 * `npx bytesjev`               the MCP server over stdio (what Claude Code launches)
 * `npx bytesjev viz`           the live dashboard on http://localhost:4310
 * `npx bytesjev install-skill` copy the Claude Code skill to ~/.claude/skills/bytesjev
 */
import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROJECT_ROOT } from "./config.js";

const cmd = process.argv[2];

if (cmd === undefined || cmd === "mcp") {
  await import("./mcp/index.js");
} else if (cmd === "viz") {
  await import("./viz/server.js");
} else if (cmd === "install-skill") {
  const from = join(PROJECT_ROOT, ".claude", "skills", "bytesjev");
  const to = join(process.env.CLAUDE_SKILLS_DIR || join(homedir(), ".claude", "skills"), "bytesjev");
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`installed the skill to ${to}`);
} else {
  console.error(`usage: bytesjev [mcp | viz | install-skill]

  (no command)   run the PlanningChecker MCP server over stdio
  viz            run the live dashboard (VIZ_PORT, default 4310)
  install-skill  copy the Claude Code skill to ~/.claude/skills/bytesjev`);
  process.exit(cmd === "--help" || cmd === "-h" ? 0 : 2);
}
