import type { NecessityJudgment, NecessityMeta } from "../jev/primitives/necessity.js";
import { necessityQuestions } from "../jev/primitives/necessity.js";
import type { CheckerInput, CheckerOutput, CheckObserver, ItemResult } from "../mcp/planning-checker.js";

/**
 * What the dashboard streams to the browser, and what the MCP server posts to
 * the dashboard. One check is: a `call`, one `item` per plan item as Jev
 * answers it, and a `done`.
 */
export type Source = "claude-code" | "page";

export interface QuestionView {
  type: string;
  instructions: string;
  criteria: Record<string, string>;
}

export type Message =
  | { type: "hello"; setup: { model: string } }
  | {
      type: "call";
      id: string;
      t: number;
      source: Source;
      request: string;
      context: string | null;
      items: Array<{ id: string; change: string; rationale?: string }>;
      limitations: string[];
      /** the six questions as sent to Jev for this call, keyed as the judgment fields */
      questions: Record<string, QuestionView>;
    }
  | { type: "item"; id: string; t: number; itemId: string; judgment: NecessityJudgment; result: ItemResult; ms: number; inputTokens: number | null }
  | { type: "done"; id: string; t: number; status: CheckerOutput["status"]; error?: string; errors?: string[]; limitations: string[]; ms: number };

export const DEFAULT_VIZ_URL = "http://localhost:4310";

let counter = 0;
export const newCallId = (): string => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** A CheckObserver that turns one check into dashboard messages. */
export function narrate(emit: (msg: Message) => void, opts: { id?: string; source: Source }): CheckObserver {
  const id = opts.id ?? newCallId();
  return {
    start(input: CheckerInput, limitations: string[]) {
      const questions = necessityQuestions({ hasContext: Boolean(input.repo_context), hasOthers: input.plan_items.length > 1 }) as unknown as Record<string, QuestionView>;
      emit({
        type: "call",
        id,
        t: Date.now(),
        source: opts.source,
        request: input.user_request,
        context: input.repo_context ?? null,
        items: input.plan_items,
        limitations,
        questions,
      });
    },
    item(judgment: NecessityJudgment, result: ItemResult, meta: NecessityMeta) {
      emit({ type: "item", id, t: Date.now(), itemId: judgment.id, judgment, result, ms: meta.ms, inputTokens: meta.inputTokens });
    },
    done(output: CheckerOutput, ms: number) {
      emit({
        type: "done",
        id,
        t: Date.now(),
        status: output.status,
        ...(output.status === "unavailable" ? { error: output.error } : {}),
        ...(output.status === "invalid" ? { errors: output.errors } : {}),
        limitations: output.limitations,
        ms,
      });
    },
  };
}
