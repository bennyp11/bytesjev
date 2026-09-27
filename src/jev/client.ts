import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TypeSafeClient,
  type EntryType,
  type Questions,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

/**
 * The one seam every primitive depends on. Production wraps the TypeSafe SDK;
 * tests pass a scripted implementation. Jev never generates text: it returns
 * typed answers (choice / score / noul) plus probabilities and confidence.
 */
export interface Jev {
  ask<Q extends Questions>(state: EntryType, questions: Q, tag?: string): Promise<SystemOneResult<Q>>;
  readonly usage: JevUsage;
}

/** Jev is billed per input token only ($42 / Btok for jev-1.13). Output is free. */
export const JEV_USD_PER_INPUT_TOKEN = 42 / 1e9;

export class JevUsage {
  requests = 0;
  cacheHits = 0;
  inputTokens = 0;
  outputTokens = 0;
  /** Per-tag counters so a report can say which primitive spent what. */
  byTag = new Map<string, { requests: number; inputTokens: number }>();

  record(tag: string, usage: { input_tokens: number; output_tokens: number }, cached: boolean): void {
    this.requests += 1;
    if (cached) this.cacheHits += 1;
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    const t = this.byTag.get(tag) ?? { requests: 0, inputTokens: 0 };
    t.requests += 1;
    t.inputTokens += usage.input_tokens;
    this.byTag.set(tag, t);
  }

  get costUsd(): number {
    return this.inputTokens * JEV_USD_PER_INPUT_TOKEN;
  }

  summary(): Record<string, unknown> {
    return {
      requests: this.requests,
      cacheHits: this.cacheHits,
      inputTokens: this.inputTokens,
      estimatedUsd: Number(this.costUsd.toFixed(5)),
      byTag: Object.fromEntries(this.byTag),
    };
  }
}

/** What an observer sees for each Jev request: enough to visualize the judgment, never the raw state. */
export interface JevCallInfo {
  tag: string;
  questionCount: number;
  inputTokens: number;
  ms: number;
  cached: boolean;
  model: string;
  /** compact answers: nouls as numbers, choices as {choice, confidence, probabilities}, scores as {score, confidence} */
  answers: Record<string, number | { choice: string; confidence: number; probabilities: Record<string, number> } | { score: number; confidence: number }>;
  /** the questions exactly as sent, so an observer can see what was asked */
  questions: Questions;
  /** the state as sent, truncated for display */
  statePreview: string;
  stateChars: number;
}

const STATE_PREVIEW_CHARS = 4000;

export interface CreateJevOptions {
  apiKey?: string;
  model?: string;
  /** Directory for the on-disk answer cache. Omit to disable caching. */
  cacheDir?: string;
  timeoutMs?: number;
  /** Observer for every request (used by the visualizer). */
  onCall?: (info: JevCallInfo) => void;
}

function compactAnswers(answers: Record<string, { type: string } & Record<string, unknown>>): JevCallInfo["answers"] {
  const out: JevCallInfo["answers"] = {};
  for (const [k, a] of Object.entries(answers)) {
    if (a.type === "noul") out[k] = a.noul as number;
    else if (a.type === "choice") out[k] = { choice: a.choice as string, confidence: a.confidence as number, probabilities: a.probabilities as Record<string, number> };
    else if (a.type === "score") out[k] = { score: a.score as number, confidence: a.confidence as number };
  }
  return out;
}

/**
 * TypeSafe-backed Jev with an optional content-addressed disk cache, in the
 * spirit of the cookbooks' json_cache: identical (model, state, questions)
 * replay for free, which keeps iteration on prompts and thresholds cheap.
 */
export function createJev(opts: CreateJevOptions = {}): Jev {
  const client = new TypeSafeClient({
    apiKey: opts.apiKey,
    defaultModel: opts.model ?? "jev-latest",
    timeout: opts.timeoutMs ?? 60_000,
  });
  const model = opts.model ?? "jev-latest";
  const usage = new JevUsage();
  if (opts.cacheDir) mkdirSync(opts.cacheDir, { recursive: true });

  const cacheKey = (state: EntryType, questions: Questions): string =>
    createHash("sha256").update(JSON.stringify({ model, state, questions })).digest("hex");

  return {
    usage,
    async ask(state, questions, tag = "untagged") {
      const started = Date.now();
      const key = opts.cacheDir ? cacheKey(state, questions) : null;
      const path = key ? join(opts.cacheDir!, `${key}.json`) : null;
      const notify = (plain: { model: string; answers: Record<string, unknown>; usage: { input_tokens: number } }, cached: boolean) => {
        if (!opts.onCall) return;
        const stateJson = typeof state === "string" ? state : JSON.stringify(state, null, 1);
        opts.onCall({
          tag,
          questionCount: Object.keys(questions).length,
          inputTokens: plain.usage.input_tokens,
          ms: Date.now() - started,
          cached,
          model: plain.model,
          answers: compactAnswers(plain.answers as Record<string, { type: string } & Record<string, unknown>>),
          questions,
          statePreview: stateJson.length > STATE_PREVIEW_CHARS ? `${stateJson.slice(0, STATE_PREVIEW_CHARS)}\n…` : stateJson,
          stateChars: stateJson.length,
        });
      };
      if (path) {
        try {
          const cached = JSON.parse(readFileSync(path, "utf8"));
          usage.record(tag, cached.usage, true);
          notify(cached, true);
          return cached;
        } catch {
          /* miss */
        }
      }
      const result = await client.systemOne({ state, questions, model });
      const plain = { model: result.model, answers: result.answers, usage: result.usage };
      usage.record(tag, result.usage, false);
      if (path) writeFileSync(path, JSON.stringify(plain));
      notify(plain, false);
      return plain as typeof result;
    },
  };
}
