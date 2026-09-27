import { describe, expect, it } from "vitest";
import { assessNecessity } from "../src/jev/primitives/necessity.js";
import { FakeJev } from "./fake-jev.js";

const items = [
  { id: "p1", change: "Add the button and copy the current URL", rationale: "Directly requested" },
  { id: "p2", change: "Create a generic action registry", rationale: "Could support future actions" },
];

describe("assessNecessity", () => {
  it("asks one request per item with the six questions, showing each item the rest of the plan", async () => {
    const jev = new FakeJev(({ key }) => (key === "necessary" ? 0.8 : 0.2));
    const out = await assessNecessity(jev, { userRequest: "Add a Copy link button", repoContext: "Actions live in ArticleActions.tsx", items });
    expect(jev.calls).toHaveLength(2);
    expect(Object.keys(jev.calls[0].questions).sort()).toEqual(["convention", "droppable", "necessary", "requested", "safety", "speculative"]);
    const state = jev.calls[1].state as { item: { change: string }; other_plan_items: string[] };
    expect(state.item.change).toBe(items[1].change);
    expect(state.other_plan_items).toEqual([items[0].change]);
    expect(out.map((j) => j.id)).toEqual(["p1", "p2"]);
    expect(out[0].necessary).toBe(0.8);
    expect(out[0].convention).toBe(0.2);
  });
  it("drops the convention question without repo context and the droppable question for a one-item plan", async () => {
    const jev = new FakeJev();
    const out = await assessNecessity(jev, { userRequest: "r", items: [items[0]] });
    expect(Object.keys(jev.calls[0].questions).sort()).toEqual(["necessary", "requested", "safety", "speculative"]);
    expect(jev.calls[0].state).not.toHaveProperty("repo_context");
    expect(out[0].convention).toBeNull();
    expect(out[0].droppable).toBeNull();
  });
  it("substitutes a placeholder when no rationale is given so the speculative question still reads", async () => {
    const jev = new FakeJev();
    await assessNecessity(jev, { userRequest: "r", items: [{ id: "x", change: "c" }] });
    expect((jev.calls[0].state as { item: { rationale: string } }).item.rationale).toBe("(none given)");
  });
});
