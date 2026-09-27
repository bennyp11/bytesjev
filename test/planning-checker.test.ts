import { APITimeoutError, AuthenticationError } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Jev } from "../src/jev/client.js";
import { JevUsage } from "../src/jev/client.js";
import { bestSentence, bound, categorize, checkPlan, LIMITS, validate } from "../src/mcp/planning-checker.js";
import { FakeJev, type Script } from "./fake-jev.js";

const request = "Add a Copy link button to the article page.";
const context = "Article actions live in ArticleActions.tsx; an existing clipboard utility is available.";
const items = [
  { id: "p1", change: "Add the button and copy the current URL", rationale: "Directly requested" },
  { id: "p2", change: "Create a generic action registry", rationale: "Could support future actions" },
  { id: "p3", change: "Use the existing clipboard utility", rationale: "Repo already has one" },
];

/** Script Jev per item id via the state it was shown. */
const perItem = (table: Record<string, Record<string, number>>): Script => ({ state, key }) => {
  const change = (state as { item: { change: string } }).item.change;
  const id = items.find((i) => i.change === change)?.id ?? "?";
  return table[id]?.[key];
};

describe("validate", () => {
  it("requires the original request and at least one item, and never reconstructs the request", () => {
    expect(validate({ plan_items: items })).toMatchObject({ ok: false });
    expect(validate({ user_request: "   ", plan_items: items })).toMatchObject({ ok: false, errors: ["user_request: must not be blank"] });
    expect(validate({ user_request: request, plan_items: [] })).toMatchObject({ ok: false });
  });
  it("rejects duplicate and blank ids", () => {
    const r = validate({ user_request: request, plan_items: [items[0], { ...items[1], id: "p1" }] });
    expect(r).toMatchObject({ ok: false, errors: ['plan_items: duplicate id "p1"'] });
    expect(validate({ user_request: request, plan_items: [{ id: "", change: "c" }] })).toMatchObject({ ok: false });
  });
  it("caps item count", () => {
    const many = Array.from({ length: LIMITS.maxItems + 1 }, (_, i) => ({ id: `i${i}`, change: "c" }));
    expect(validate({ user_request: request, plan_items: many })).toMatchObject({ ok: false });
  });
});

describe("bound", () => {
  it("truncates oversized fields and reports each truncation", () => {
    const { input, limitations } = bound({
      user_request: "r".repeat(LIMITS.requestChars + 5),
      repo_context: "c".repeat(LIMITS.contextChars + 5),
      plan_items: [{ id: "a", change: "x".repeat(LIMITS.changeChars + 1), rationale: "y".repeat(LIMITS.rationaleChars + 1) }],
    });
    expect(input.user_request.length).toBe(LIMITS.requestChars + 1);
    expect(limitations).toEqual([
      expect.stringContaining("user_request was truncated"),
      expect.stringContaining("repo_context was truncated"),
      expect.stringContaining("plan_items[a].change was truncated"),
      expect.stringContaining("plan_items[a].rationale was truncated"),
    ]);
  });
  it("reports missing repo context as a limitation instead of assuming a convention", () => {
    const { input, limitations } = bound({ user_request: request, repo_context: "  ", plan_items: [items[0]] });
    expect(input.repo_context).toBeUndefined();
    expect(limitations[0]).toMatch(/repo_context was not supplied/);
  });
});

describe("bestSentence", () => {
  it("picks the submitted sentence that shares the most words with the change", () => {
    const text = "We use React here. Article actions live in ArticleActions.tsx. Tests run with vitest.";
    expect(bestSentence(text, "Add the button to article actions")).toBe("Article actions live in ArticleActions.tsx.");
  });
});

describe("checkPlan", () => {
  it("returns one result per input id in order, with keep / simplify / keep for the copy-link example", async () => {
    const jev = new FakeJev(
      perItem({
        p1: { necessary: 0.95, requested: 0.95, convention: 0.2, safety: 0.3, speculative: 0.05, droppable: 0.05 },
        p2: { necessary: 0.1, requested: 0.05, convention: 0.05, safety: 0.05, speculative: 0.9, droppable: 0.9 },
        p3: { necessary: 0.8, requested: 0.3, convention: 0.9, safety: 0.2, speculative: 0.1, droppable: 0.5 },
      }),
    );
    const out = await checkPlan({ user_request: request, repo_context: context, plan_items: items }, { jev });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.results.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
    expect(out.results.map((r) => r.recommendation)).toEqual(["keep", "simplify", "keep"]);
    expect(out.results[0].evidence[0]).toBe(request);
    expect(out.results[0].reason).toMatch(/request itself asks/);
    expect(out.results[1].evidence).toContain("Could support future actions");
    expect(out.results[1].reason).toMatch(/remaining plan items alone/);
    expect(out.results[2].reason).toMatch(/repository context states a convention/);
    expect(out.results[2].evidence[0]).toMatch(/clipboard utility/);
    expect(out.results.every((r) => !r.uncertain)).toBe(true);
    expect(out.limitations).toEqual([]);
  });

  it("never recommends simplify for a one-item plan: there is no smaller path", async () => {
    const jev = new FakeJev(() => 0.05);
    const out = await checkPlan({ user_request: request, plan_items: [items[1]] }, { jev });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.results[0].recommendation).toBe("review");
    expect(out.results[0].reason).toMatch(/only plan item/);
  });

  it("never recommends simplify when a correctness or security signal is present", async () => {
    const jev = new FakeJev(({ key }) => (key === "safety" ? 0.6 : key === "droppable" ? 0.9 : 0.1));
    const out = await checkPlan({ user_request: request, plan_items: items }, { jev });
    if (out.status !== "ok") throw new Error(out.status);
    expect(out.results.map((r) => r.recommendation)).toEqual(["review", "review", "review"]);
    expect(out.results[0].reason).toMatch(/correctness or security signal/);
  });

  it("marks mid-band and conflicting judgments uncertain and keeps them advisory", async () => {
    const jev = new FakeJev(
      perItem({
        p1: { necessary: 0.5, requested: 0.5, safety: 0.3, speculative: 0.3, droppable: 0.4 },
        p2: { necessary: 0.1, requested: 0.9, safety: 0.1, speculative: 0.1, droppable: 0.9 },
        p3: { necessary: 0.9, requested: 0.1, safety: 0.1, speculative: 0.1, droppable: 0.9 },
      }),
    );
    const out = await checkPlan({ user_request: request, plan_items: items }, { jev });
    if (out.status !== "ok") throw new Error(out.status);
    expect(out.results.map((r) => [r.recommendation, r.uncertain])).toEqual([["review", true], ["review", true], ["review", true]]);
    expect(out.results[0].reason).toMatch(/too close to even/);
    expect(out.results[1].reason).toMatch(/Signals conflict/);
  });

  it("fails open on a timeout with status unavailable and an empty results array", async () => {
    const jev: Jev = { usage: new JevUsage(), ask: async () => { throw new APITimeoutError(20_000); } };
    const out = await checkPlan({ user_request: request, plan_items: items }, { jev });
    expect(out).toMatchObject({ status: "unavailable", results: [], error: "timeout" });
  });

  it("fails open without an API key and never makes a call", async () => {
    const out = await checkPlan({ user_request: request, plan_items: items }, { jev: null });
    expect(out).toMatchObject({ status: "unavailable", results: [], error: "no_api_key" });
  });

  it("returns a validation error, not invented results, for bad input", async () => {
    const jev = new FakeJev();
    const out = await checkPlan({ plan_items: items }, { jev });
    expect(out.status).toBe("invalid");
    expect(out.results).toEqual([]);
    expect(jev.calls).toHaveLength(0);
  });

  it("does not leak the API key: only submitted text reaches the output", async () => {
    process.env.TYPESAFE_API_KEY = "ts-secret-key-123";
    const jev = new FakeJev(() => 0.9);
    const out = await checkPlan({ user_request: request, repo_context: context, plan_items: items }, { jev });
    expect(JSON.stringify(out)).not.toContain("ts-secret-key-123");
    const sent = JSON.stringify(jev.calls.map((c) => c.state));
    expect(sent).not.toContain("ts-secret-key-123");
  });
});

describe("categorize", () => {
  it("maps SDK errors to short categories", () => {
    expect(categorize(new APITimeoutError(20_000))).toBe("timeout");
    expect(categorize(new AuthenticationError(401, {}, new Headers()))).toBe("auth");
    expect(categorize(new Error("fetch failed"))).toBe("network");
    expect(categorize(new Error("weird"))).toBe("unknown");
  });
});
