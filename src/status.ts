import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CheckerInput, CheckerOutput, CheckObserver } from "./mcp/planning-checker.js";

/**
 * The Claude Code status line: one small file the MCP server rewrites on every
 * check, and a status-line command that prints it. Two lines at most, the
 * newest check only, so nothing accumulates.
 */
export const STATUS_DIR = join(homedir(), ".claude", "bytesjev");
export const STATUS_FILE = join(STATUS_DIR, "status.txt");
/** what `setup` puts in settings.json when no status line is configured */
export const STATUS_LINE_COMMAND = `cat "${STATUS_FILE}" 2>/dev/null`;

const A = { reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m", orange: "\x1b[33m", blue: "\x1b[34m", bold: "\x1b[1m" };
const PLAIN = { reset: "", dim: "", green: "", orange: "", blue: "", bold: "" };
const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const short = (s: string, n = 44): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** OSC 8 hyperlink: Cmd+click opens it in terminals that support links (iTerm2, Ghostty, Kitty, WezTerm). */
const link = (text: string, url: string | undefined): string => (url ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text);

export interface StatusFormat {
  color?: boolean;
  /** dashboard URL for this check; the line becomes a link to it */
  url?: string;
}

function head(t: number, f: StatusFormat): string {
  const c = f.color === false ? PLAIN : A;
  return link(`${c.bold}/bytesjev${c.reset} ${c.dim}${clock(t)}${c.reset}`, f.url);
}

export function formatJudging(t: number, count: number, f: StatusFormat = {}): string {
  return `${head(t, f)} · judging ${count} plan ${count === 1 ? "item" : "items"}…`;
}

export function formatDone(t: number, input: CheckerInput | null, out: CheckerOutput, ms: number, f: StatusFormat = {}): string {
  const c = f.color === false ? PLAIN : A;
  const head = link(`${c.bold}/bytesjev${c.reset} ${c.dim}${clock(t)}${c.reset}`, f.url);
  if (out.status === "invalid") return `${head} · invalid input (${out.errors[0] ?? "see the tool result"})`;
  if (out.status === "unavailable") return `${head} · Jev unavailable (${out.error}) · the plan went ahead unchecked`;
  const n = { keep: 0, simplify: 0, review: 0 };
  for (const r of out.results) n[r.recommendation] += 1;
  const line1 = `${head} · ${out.results.length} ${out.results.length === 1 ? "item" : "items"} · ${c.green}keep ${n.keep}${c.reset} · ${c.orange}simplify ${n.simplify}${c.reset} · ${c.blue}review ${n.review}${c.reset} ${c.dim}· ${(ms / 1000).toFixed(1)}s${c.reset}`;
  const change = (id: string) => short(input?.plan_items.find((i) => i.id === id)?.change ?? id);
  // Name at most three flagged items per group; the dashboard and the tool result have the rest.
  const list = (ids: string[]) => ids.slice(0, 3).map(change).join(" · ") + (ids.length > 3 ? ` +${ids.length - 3}` : "");
  const flagged: string[] = [];
  const simp = out.results.filter((r) => r.recommendation === "simplify").map((r) => r.id);
  const rev = out.results.filter((r) => r.recommendation === "review").map((r) => r.id);
  if (simp.length) flagged.push(`${c.orange}simplify${c.reset} ${list(simp)}`);
  if (rev.length) flagged.push(`${c.blue}review${c.reset} ${list(rev)}`);
  return flagged.length ? `${line1}\n${link(flagged.join("   "), f.url)}` : line1;
}

function write(text: string): void {
  try {
    mkdirSync(STATUS_DIR, { recursive: true });
    writeFileSync(STATUS_FILE, `${text}\n`);
  } catch {
    /* the status line is a convenience; never fail a check over it */
  }
}

/** A CheckObserver that keeps the status file current. With `url`, the line links to this check on the dashboard. */
export function statusObserver(opts: { url?: string } = {}): CheckObserver {
  let input: CheckerInput | null = null;
  return {
    start(i) {
      input = i;
      write(formatJudging(Date.now(), i.plan_items.length, opts));
    },
    done(out, ms) {
      write(formatDone(Date.now(), input, out, ms, opts));
    },
  };
}

/** Run several observers as one. */
export function combine(...observers: CheckObserver[]): CheckObserver {
  return {
    start: (input, limitations) => observers.forEach((o) => o.start?.(input, limitations)),
    item: (j, r, meta) => observers.forEach((o) => o.item?.(j, r, meta)),
    done: (out, ms) => observers.forEach((o) => o.done?.(out, ms)),
  };
}
