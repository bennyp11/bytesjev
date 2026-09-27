#!/usr/bin/env node
/**
 * `npx bytesjev setup`         one-time: ask for the key, register the MCP server with Claude Code, install the skill
 * `npx bytesjev`               the MCP server over stdio (what Claude Code launches)
 * `npx bytesjev viz`           the live dashboard on http://localhost:4310
 * `npx bytesjev install-skill` copy the Claude Code skill to ~/.claude/skills/bytesjev
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PROJECT_ROOT } from "./config.js";

const cmd = process.argv[2];

function installSkill(): string {
  const from = join(PROJECT_ROOT, ".claude", "skills", "bytesjev");
  const to = join(process.env.CLAUDE_SKILLS_DIR || join(homedir(), ".claude", "skills"), "bytesjev");
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  return to;
}

/** Ask for the key without echoing it. `--key X` or TYPESAFE_API_KEY in the environment skips the prompt. */
async function askKey(): Promise<string> {
  const flag = process.argv.indexOf("--key");
  if (flag > 0 && process.argv[flag + 1]) return process.argv[flag + 1].trim();
  if (process.env.TYPESAFE_API_KEY?.trim()) return process.env.TYPESAFE_API_KEY.trim();
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const mute = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
  const original = mute._writeToOutput;
  return new Promise((resolve) => {
    rl.question("TypeSafe API key (from https://typesafe.ai, input is hidden): ", (answer) => {
      mute._writeToOutput = original;
      process.stderr.write("\n");
      rl.close();
      resolve(answer.trim());
    });
    mute._writeToOutput = () => {};
  });
}

async function setup(): Promise<void> {
  const key = await askKey();
  if (!key) {
    console.error("No key given. Get one at https://typesafe.ai and run `npx bytesjev setup` again.");
    process.exit(2);
  }
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (claude.error || claude.status !== 0) {
    console.error(`Claude Code's \`claude\` command was not found on PATH. Add this to your MCP config yourself:\n` +
      `  { "mcpServers": { "bytesjev": { "command": "npx", "args": ["-y", "bytesjev"], "env": { "TYPESAFE_API_KEY": "<your key>" } } } }`);
  } else {
    // Replace any earlier registration so re-running setup updates the key.
    spawnSync("claude", ["mcp", "remove", "--scope", "user", "bytesjev"], { stdio: "ignore" });
    const add = spawnSync("claude", ["mcp", "add", "--scope", "user", "bytesjev", "-e", `TYPESAFE_API_KEY=${key}`, "--", "npx", "-y", "bytesjev"], { encoding: "utf8" });
    if (add.status !== 0) {
      console.error(`Registering the server with Claude Code failed:\n${(add.stderr || add.stdout || "").trim()}`);
      process.exit(1);
    }
    console.log("Registered the bytesjev MCP server with Claude Code for your user (key stored in Claude Code's config, not in any repo).");
  }
  const to = installSkill();
  console.log(`Installed the skill to ${to}.`);
  console.log("\nDone. In an open Claude Code session run /mcp and reconnect; new sessions have PlanningChecker already.");
  console.log("To watch it judge plans live: npx bytesjev viz, then open http://localhost:4310");
}

if (cmd === undefined || cmd === "mcp") {
  await import("./mcp/index.js");
} else if (cmd === "setup") {
  await setup();
} else if (cmd === "viz") {
  await import("./viz/server.js");
} else if (cmd === "install-skill") {
  console.log(`installed the skill to ${installSkill()}`);
} else {
  console.error(`usage: bytesjev [setup | mcp | viz | install-skill]

  setup          one-time: ask for the TypeSafe key, register the MCP server with Claude Code, install the skill
  (no command)   run the PlanningChecker MCP server over stdio
  viz            run the live dashboard (VIZ_PORT, default 4310)
  install-skill  copy the Claude Code skill to ~/.claude/skills/bytesjev`);
  process.exit(cmd === "--help" || cmd === "-h" ? 0 : 2);
}
