import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import type { Jev } from "../jev/client.js";
import { assessNecessity, type NecessityJudgment, type NecessityMeta } from "../jev/primitives/necessity.js";

/**
 * PlanningChecker: the one tool BytesJev exposes.
 *
 * Validates the caller's input, caps what is sent to Jev, asks the necessity
 * primitive about every plan item, and turns the judgments into an advisory
 * recommendation per item. Every reason cites text the caller submitted;
 * nothing about the repository is invented. Jev outages fail open.
 */

export const LIMITS = {
  maxItems: 25,
  requestChars: 4000,
  contextChars: 8000,
  changeChars: 1000,
  rationaleChars: 1000,
};

export const THRESHOLDS = {
  /** necessity at or above this: keep */
  keep: 0.65,
  /** necessity below this: candidate for simplify */
  low: 0.35,
  /** a single supporting signal (requested / convention / safety) strong enough to name in the reason */
  support: 0.7,
  /** the other items alone satisfy the request */
  droppable: 0.7,
  /** any requested / convention / safety signal at or above this blocks simplify */
  block: 0.5,
  /** half-width of the band around 0.5 that is treated as uncertain */
  midband: 0.15,
};

export const planItemSchema = z.object({
  id: z.string().min(1, "id must be a non-empty string"),
  change: z.string().min(1, "change must be a non-empty string"),
  rationale: z.string().optional(),
});

export const checkerInputSchema = z.object({
  user_request: z.string().min(1, "user_request is required and must be the verbatim original request"),
  repo_context: z.string().optional(),
  plan_items: z.array(planItemSchema).min(1, "at least one plan item is required").max(LIMITS.maxItems, `at most ${LIMITS.maxItems} plan items per call`),
});

export type CheckerInput = z.infer<typeof checkerInputSchema>;
export type Recommendation = "keep" | "simplify" | "review";
export type ErrorCategory = "no_api_key" | "timeout" | "network" | "auth" | "rate_limit" | "server_error" | "unknown";

export interface ItemResult {
  id: string;
  necessity_score: number;
  recommendation: Recommendation;
  reason: string;
  evidence: string[];
  uncertain: boolean;
}

export type CheckerOutput =
  | { status: "ok"; results: ItemResult[]; limitations: string[] }
  | { status: "unavailable"; results: []; error: ErrorCategory; limitations: string[] }
  | { status: "invalid"; results: []; errors: string[]; limitations: [] };

/* ------------------------------------------------------------------ */
/* Validation and caps                                                 */
/* ------------------------------------------------------------------ */

export function validate(raw: unknown): { ok: true; input: CheckerInput } | { ok: false; errors: string[] } {
  const parsed = checkerInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
  }
  const input = parsed.data;
  const errors: string[] = [];
  if (!input.user_request.trim()) errors.push("user_request: must not be blank");
  const seen = new Set<string>();
  for (const item of input.plan_items) {
    if (!item.id.trim()) errors.push("plan_items: every id must be non-empty");
    if (!item.change.trim()) errors.push(`plan_items[${item.id}].change: must not be blank`);
    if (seen.has(item.id)) errors.push(`plan_items: duplicate id "${item.id}"`);
    seen.add(item.id);
  }
  return errors.length ? { ok: false, errors } : { ok: true, input };
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  const t = text.trim();
  return t.length > max ? { text: `${t.slice(0, max)}…`, truncated: true } : { text: t, truncated: false };
}

/** Apply payload caps and record every truncation as a limitation the caller can see. */
export function bound(input: CheckerInput): { input: CheckerInput; limitations: string[] } {
  const limitations: string[] = [];
  const req = clip(input.user_request, LIMITS.requestChars);
  if (req.truncated) limitations.push(`user_request was truncated to ${LIMITS.requestChars} characters`);
  let repo_context: string | undefined;
  if (input.repo_context && input.repo_context.trim()) {
    const ctx = clip(input.repo_context, LIMITS.contextChars);
    if (ctx.truncated) limitations.push(`repo_context was truncated to ${LIMITS.contextChars} characters; conventions beyond that point were not considered`);
    repo_context = ctx.text;
  } else {
    limitations.push("repo_context was not supplied; existing conventions and constraints could not be considered, so no item was credited to a repository convention");
  }
  const plan_items = input.plan_items.map((item) => {
    const change = clip(item.change, LIMITS.changeChars);
    if (change.truncated) limitations.push(`plan_items[${item.id}].change was truncated to ${LIMITS.changeChars} characters`);
    const rationale = item.rationale ? clip(item.rationale, LIMITS.rationaleChars) : undefined;
    if (rationale?.truncated) limitations.push(`plan_items[${item.id}].rationale was truncated to ${LIMITS.rationaleChars} characters`);
    return { id: item.id, change: change.text, rationale: rationale?.text };
  });
  return { input: { user_request: req.text, repo_context, plan_items }, limitations };
}

/* ------------------------------------------------------------------ */
/* Evidence: quote what the caller sent, never what Jev might infer    */
/* ------------------------------------------------------------------ */

const STOP = new Set(["the", "and", "for", "that", "this", "with", "from", "into", "are", "was", "will", "have", "has", "add", "new", "use"]);
const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

/** The sentence of `text` that shares the most vocabulary with `probe`, clipped for display. */
export function bestSentence(text: string, probe: string, maxChars = 200): string | undefined {
  const probeSet = new Set(tokens(probe));
  let best: string | undefined;
  let bestScore = 0;
  for (const raw of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const s = raw.trim();
    if (!s) continue;
    const t = tokens(s);
    const overlap = t.filter((w) => probeSet.has(w)).length;
    const score = overlap / Math.sqrt(t.length + 1);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (!best) return undefined;
  return best.length > maxChars ? `${best.slice(0, maxChars)}…` : best;
}

/* ------------------------------------------------------------------ */
/* Decision logic                                                      */
/* ------------------------------------------------------------------ */

const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function decide(
  j: NecessityJudgment,
  item: { change: string; rationale?: string },
  ctx: { userRequest: string; repoContext?: string; hasOthers: boolean },
  t = THRESHOLDS,
): ItemResult {
  const evidence: string[] = [];
  const pushEvidence = (s: string | undefined) => {
    if (s && !evidence.includes(s)) evidence.push(s);
  };

  const supported = {
    requested: j.requested >= t.support,
    convention: (j.convention ?? 0) >= t.support,
    safety: j.safety >= t.support,
  };
  const anySupport = supported.requested || supported.convention || supported.safety;
  const low = j.necessary < t.low;
  // A strong request or convention signal is enough to keep, whatever the summary score says.
  const high = j.necessary >= t.keep || supported.requested || supported.convention;
  const droppable = (j.droppable ?? 0) >= t.droppable;

  const midband = Math.abs(j.necessary - 0.5) < t.midband;
  const conflict = (low && anySupport) || (j.necessary >= t.keep && droppable && j.requested < t.low);
  const uncertain = (midband && !supported.requested && !supported.convention) || conflict;

  // Evidence always starts from the caller's own text.
  if (supported.requested) pushEvidence(bestSentence(ctx.userRequest, item.change));
  if (supported.convention && ctx.repoContext) pushEvidence(bestSentence(ctx.repoContext, item.change));
  if (high && evidence.length === 0) pushEvidence(bestSentence(ctx.userRequest, item.change));
  if (j.speculative >= t.support && item.rationale) pushEvidence(item.rationale);
  if (evidence.length === 0) pushEvidence(bestSentence(ctx.userRequest, item.change) ?? item.rationale ?? item.change);

  const signals: string[] = [];
  if (supported.requested) signals.push(`the request asks for it (${pct(j.requested)})`);
  if (supported.convention) signals.push(`the supplied repository context names a convention or utility it follows (${pct(j.convention!)})`);
  if (supported.safety) signals.push(`it is needed for correctness or security (${pct(j.safety)})`);
  if (j.speculative >= t.support) signals.push(`the rationale describes a possible future use rather than a present need (${pct(j.speculative)})`);
  if (droppable) signals.push(`the other plan items alone would satisfy the request (${pct(j.droppable!)})`);

  let recommendation: Recommendation;
  let reason: string;

  if (uncertain) {
    recommendation = "review";
    reason = conflict
      ? `Signals conflict: ${signals.join("; ") || "no single signal is strong"}. Necessity ${pct(j.necessary)}. Decide from the concrete need, not from this score.`
      : `Necessity ${pct(j.necessary)} is too close to even to act on. ${signals.length ? `Signals: ${signals.join("; ")}.` : "No strong signal either way."} Keep it only if you can name the concrete need.`;
  } else if (high) {
    recommendation = "keep";
    reason = supported.requested
      ? "The request itself asks for this work."
      : supported.convention
        ? "The supplied repository context states a convention or utility this item follows."
        : supported.safety
          ? "The submitted context indicates this is needed for the requested change to be correct or secure."
          : `Judged necessary from the request and context (${pct(j.necessary)}) without one dominant signal.`;
  } else if (low && ctx.hasOthers && droppable && j.safety < t.block && j.requested < t.block && (j.convention ?? 0) < t.block) {
    recommendation = "simplify";
    reason = `Nothing in the request or supplied context requires this, and the remaining plan items alone would satisfy the request (${pct(j.droppable!)}).${j.speculative >= t.support ? " The rationale describes a possible future use, not a present need." : ""}${!ctx.repoContext ? " No repository context was supplied, so an existing convention could not be checked." : ""}`;
  } else if (low) {
    recommendation = "review";
    if (!ctx.hasOthers) {
      reason = "Nothing in the request or supplied context clearly requires this, but it is the only plan item, so there is no smaller path to recommend.";
    } else {
      const blockers: string[] = [];
      if (j.safety >= t.block) blockers.push(`there is a correctness or security signal (${pct(j.safety)})`);
      if ((j.convention ?? 0) >= t.block) blockers.push(`it may reuse something the repository context says exists (${pct(j.convention!)})`);
      if (j.requested >= t.block) blockers.push(`the request partly supports it (${pct(j.requested)})`);
      if (!droppable) blockers.push(`the other items alone were not judged to satisfy the request (${pct(j.droppable ?? 0)})`);
      reason = `Nothing in the request or supplied context clearly requires this, but ${blockers.join(", and ")}. Confirm the concrete need or narrow it.`;
    }
  } else {
    recommendation = "review";
    reason = `Necessity ${pct(j.necessary)}: partial support only. ${signals.length ? `Signals: ${signals.join("; ")}.` : ""} Keep it if you can name the concrete dependency or constraint.`.trim();
  }

  return { id: j.id, necessity_score: round(j.necessary), recommendation, reason, evidence, uncertain };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export function categorize(err: unknown): ErrorCategory {
  if (err instanceof APITimeoutError) return "timeout";
  if (err instanceof APIConnectionError) return "network";
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return "auth";
  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof APIError) return err.status >= 500 ? "server_error" : "unknown";
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  if (msg.includes("fetch failed") || msg.includes("econnrefused") || msg.includes("enotfound")) return "network";
  return "unknown";
}

/** Watches one check as it happens: what was sent, each item as Jev answers it, and the outcome. */
export interface CheckObserver {
  start?(input: CheckerInput, limitations: string[]): void;
  item?(judgment: NecessityJudgment, result: ItemResult, meta: NecessityMeta): void;
  done?(output: CheckerOutput, ms: number): void;
}

export interface CheckOptions {
  /** null when no key is configured: the tool answers `unavailable` without a network call */
  jev: Jev | null;
  thresholds?: typeof THRESHOLDS;
  observe?: CheckObserver;
}

export async function checkPlan(raw: unknown, opts: CheckOptions): Promise<CheckerOutput> {
  const started = Date.now();
  const finish = (out: CheckerOutput): CheckerOutput => {
    opts.observe?.done?.(out, Date.now() - started);
    return out;
  };
  const v = validate(raw);
  if (!v.ok) return finish({ status: "invalid", results: [], errors: v.errors, limitations: [] });
  const { input, limitations } = bound(v.input);
  opts.observe?.start?.(input, limitations);

  if (!opts.jev) {
    return finish({ status: "unavailable", results: [], error: "no_api_key", limitations: [...limitations, "TYPESAFE_API_KEY is not set; proceed without the check"] });
  }

  const byId = new Map(input.plan_items.map((i) => [i.id, i]));
  const ctx = { userRequest: input.user_request, repoContext: input.repo_context, hasOthers: input.plan_items.length > 1 };
  let judgments: NecessityJudgment[];
  try {
    judgments = await assessNecessity(
      opts.jev,
      { userRequest: input.user_request, repoContext: input.repo_context, items: input.plan_items },
      opts.observe?.item ? (j, meta) => opts.observe!.item!(j, decide(j, byId.get(j.id)!, ctx, opts.thresholds), meta) : undefined,
    );
  } catch (err) {
    return finish({ status: "unavailable", results: [], error: categorize(err), limitations: [...limitations, "Jev did not answer; proceed without the check"] });
  }

  const results = judgments.map((j) => decide(j, byId.get(j.id)!, ctx, opts.thresholds));
  return finish({ status: "ok", results, limitations });
}
