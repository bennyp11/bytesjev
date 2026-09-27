import { noul, type JsonValue } from "@typesafe-ai/sdk";
import type { Jev } from "../client.js";

/**
 * Necessity: is a proposed plan item needed, or is it overengineering?
 *
 * One Jev request per item, six atomic judgments over the original request,
 * the supplied repository context, this item, and the other items in the
 * plan. Code (planning-checker.ts) turns the judgments into a recommendation;
 * Jev never sees the thresholds and never generates prose.
 *
 * The rest of the plan is the "smaller path": if the request would still be
 * satisfied by the other items alone, dropping this one is a concrete
 * simplification rather than a vague "do less".
 */

export interface PlanItem {
  id: string;
  change: string;
  rationale?: string;
}

export interface NecessityInput {
  userRequest: string;
  /** undefined when the caller supplied no repository context */
  repoContext?: string;
  items: PlanItem[];
}

export interface NecessityJudgment {
  id: string;
  /** the necessity question itself: needed by the request, a stated constraint, or correctness/security */
  necessary: number;
  /** the request directly asks for or requires this item */
  requested: number;
  /** repo_context states a convention, utility, or constraint this item follows; null without context */
  convention: number | null;
  /** needed for the change to be correct or secure, as opposed to flexible or reusable */
  safety: number;
  /** the rationale is about future use or generality rather than a present need */
  speculative: number;
  /** the other plan items alone would satisfy the request; null for a one-item plan */
  droppable: number | null;
}

export function necessityQuestions(opts: { hasContext: boolean; hasOthers: boolean }) {
  const contextClause = opts.hasContext ? ", to follow a constraint or convention stated in `repo_context`," : "";
  return {
    necessary: noul(
      `Is the work in \`item\` needed to satisfy \`request\`${contextClause} or to meet a concrete correctness or security need that the request implies?`,
      {
        true: "The request, a stated repository constraint, or a concrete correctness or security need requires this work",
        false: "Nothing in the request or the supplied context requires this work; the request would still be fulfilled without it",
      },
    ),
    requested: noul("Does `request` itself ask for, or directly require, the work described in `item`?", {
      true: "The request names this work or cannot be fulfilled without it",
      false: "The request does not mention this work and could be fulfilled without it",
    }),
    ...(opts.hasContext
      ? {
          convention: noul(
            "Does `repo_context` describe something that already exists in the repository which the work in `item` reuses, or a rule or constraint that makes the work in `item` required?",
            {
              true: "The item reuses a utility, file, or pattern that the context says already exists, or the context states a rule that requires this work",
              false: "The item adds something new that the context does not say exists, the context says no such thing exists, or the context states no rule requiring it",
            },
          ),
        }
      : {}),
    safety: noul(
      "Is the work in `item` needed for the requested change to behave correctly or securely, rather than for flexibility, reuse, or possible future work?",
      {
        true: "Without this work the requested change would be incorrect, unsafe, or would break something stated in the context",
        false: "This work is about structure, generality, reuse, or convenience, not about the requested change being correct or secure",
      },
    ),
    speculative: noul(
      "Is the stated `rationale` for `item` about a possible future use, generality, or reuse, rather than a present need in `request` or the supplied context?",
      {
        true: "The rationale appeals to future needs, extensibility, reuse, or what might be wanted later",
        false: "The rationale points to a present requirement in the request or context, or no rationale is given",
      },
    ),
    ...(opts.hasOthers
      ? {
          droppable: noul(
            "If the work in `item` were left out and only `other_plan_items` were done, would `request` still be completely satisfied?",
            {
              true: "The other plan items alone fully satisfy the request",
              false: "Leaving this item out would leave part of the request unfulfilled or would break the other items",
            },
          ),
        }
      : {}),
  };
}

export async function assessNecessity(jev: Jev, input: NecessityInput): Promise<NecessityJudgment[]> {
  const hasContext = Boolean(input.repoContext && input.repoContext.trim());
  return Promise.all(
    input.items.map(async (item) => {
      const others = input.items.filter((o) => o.id !== item.id).map((o) => o.change);
      const hasOthers = others.length > 0;
      const state: Record<string, JsonValue> = {
        request: input.userRequest,
        ...(hasContext ? { repo_context: input.repoContext } : {}),
        item: { change: item.change, rationale: item.rationale?.trim() || "(none given)" },
        ...(hasOthers ? { other_plan_items: others } : {}),
      };
      const questions = necessityQuestions({ hasContext, hasOthers });
      const { answers } = await jev.ask(state, questions, "necessity");
      const a = answers as Record<string, { noul: number } | undefined>;
      return {
        id: item.id,
        necessary: a.necessary!.noul,
        requested: a.requested!.noul,
        convention: hasContext ? a.convention!.noul : null,
        safety: a.safety!.noul,
        speculative: a.speculative!.noul,
        droppable: hasOthers ? a.droppable!.noul : null,
      };
    }),
  );
}
