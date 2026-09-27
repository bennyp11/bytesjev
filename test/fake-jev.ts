import type { EntryType, Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { JevUsage, type Jev } from "../src/jev/client.js";

type AnyAnswer = { type: "noul"; noul: number } | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number } | { type: "score"; score: number; confidence: number; legend: Record<string, unknown>; probabilities: Record<string, number> };

export type Script = (args: { state: EntryType; questions: Questions; tag: string; key: string; question: Questions[string] }) => Partial<AnyAnswer> | number | string | undefined;

/**
 * Scripted Jev. A script returns, per question key, either a number (noul
 * value or score), a string (choice label), or a partial answer object. Any
 * key the script does not cover gets a neutral default. Every call is
 * recorded so tests can assert what state Jev was shown.
 */
export class FakeJev implements Jev {
  readonly usage = new JevUsage();
  readonly calls: Array<{ state: EntryType; questions: Questions; tag: string }> = [];
  constructor(private script: Script = () => undefined) {}

  async ask<Q extends Questions>(state: EntryType, questions: Q, tag = "untagged"): Promise<SystemOneResult<Q>> {
    this.calls.push({ state, questions, tag });
    const answers: Record<string, AnyAnswer> = {};
    for (const [key, q] of Object.entries(questions)) {
      const scripted = this.script({ state, questions, tag, key, question: q });
      answers[key] = materialize(q, scripted);
    }
    const usage = { input_tokens: JSON.stringify(state).length / 4, output_tokens: 1 };
    this.usage.record(tag, usage, false);
    return { model: "fake-jev", answers: answers as SystemOneResult<Q>["answers"], usage };
  }
}

function materialize(q: Questions[string], scripted: ReturnType<Script>): AnyAnswer {
  if (q.type === "noul") {
    const v = typeof scripted === "number" ? scripted : typeof scripted === "object" && scripted && "noul" in scripted ? (scripted.noul as number) : 0.5;
    return { type: "noul", noul: v };
  }
  if (q.type === "choice") {
    const labels = Object.keys(q.criteria);
    const pick = typeof scripted === "string" ? scripted : typeof scripted === "object" && scripted && "choice" in scripted ? (scripted.choice as string) : labels[0];
    const confidence = typeof scripted === "object" && scripted && "confidence" in scripted ? (scripted.confidence as number) : 0.95;
    const scriptedProbs = typeof scripted === "object" && scripted && "probabilities" in scripted ? (scripted.probabilities as Record<string, number>) : undefined;
    const probabilities = scriptedProbs ?? Object.fromEntries(labels.map((l) => [l, l === pick ? 1 : 0]));
    return { type: "choice", choice: pick, probabilities, confidence };
  }
  const levels = q.criteria.length;
  const score = typeof scripted === "number" ? scripted : typeof scripted === "object" && scripted && "score" in scripted ? (scripted.score as number) : 0;
  const confidence = typeof scripted === "object" && scripted && "confidence" in scripted ? (scripted.confidence as number) : 0.9;
  const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), c]));
  const probabilities = Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), i === Math.round(score) ? 1 : 0]));
  return { type: "score", score, confidence, legend, probabilities };
}
