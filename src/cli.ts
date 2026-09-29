#!/usr/bin/env node
/**
 * `npx bytesjev setup`         one-time: ask for the key, register the MCP server with Claude Code, install the skill
 * `npx bytesjev`               the MCP server over stdio (what Claude Code launches)
 * `npx bytesjev viz`           the live dashboard on http://localhost:4310
 * `npx bytesjev install-skill` copy the Claude Code skill to ~/.claude/skills/bytesjev
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PROJECT_ROOT } from "./config.js";
import { STATUS_FILE, STATUS_LINE_COMMAND } from "./status.js";

const cmd = process.argv[2];

function installSkill(): string {
  const from = join(PROJECT_ROOT, ".claude", "skills", "bytesjev");
  const to = join(process.env.CLAUDE_SKILLS_DIR || join(homedir(), ".claude", "skills"), "bytesjev");
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  return to;
}

/**
 * Show each check's verdicts in Claude Code's status line, under the chat.
 * Adds a statusLine to ~/.claude/settings.json when none is configured;
 * otherwise leaves the existing one alone and says what to append.
 */
function installStatusLine(): string {
  const path = join(homedir(), ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    /* missing or empty: start fresh */
  }
  if (settings.statusLine) {
    return `You already have a status line; to add the verdicts to it, append this to its command:  ; ${STATUS_LINE_COMMAND}`;
  }
  settings.statusLine = { type: "command", command: STATUS_LINE_COMMAND, refreshInterval: 2 };
  mkdirSync(join(homedir(), ".claude"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return "Added a status line to ~/.claude/settings.json: each check's verdicts show under the chat.";
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
  console.log(installStatusLine());
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
} else if (cmd === "status") {
  // The last check's verdicts, as written by the MCP server. Usable directly as a status line command.
  try {
    process.stdout.write(readFileSync(STATUS_FILE, "utf8"));
  } catch {
    /* no check yet: print nothing */
  }
} else {
  console.error(`usage: bytesjev [setup | mcp | viz | status | install-skill]

  setup          one-time: ask for the TypeSafe key, register the MCP server with Claude Code, install the skill and the status line
  (no command)   run the PlanningChecker MCP server over stdio
  viz            run the live dashboard (VIZ_PORT, default 4310)
  status         print the last check's verdicts (what the status line shows)
  install-skill  copy the Claude Code skill to ~/.claude/skills/bytesjev`);
  process.exit(cmd === "--help" || cmd === "-h" ? 0 : 2);
}
