import { describe, expect, it } from "vitest";
import { EXAMPLE } from "../src/example.js";
import { checkPlan } from "../src/mcp/planning-checker.js";
import { combine, formatDone, formatJudging } from "../src/status.js";
import { FakeJev } from "./fake-jev.js";

describe("status line text", () => {
  it("says what is being judged, then the tally and the flagged items", async () => {
    expect(formatJudging(0, 6, false)).toMatch(/^\/bytesjev .+ · judging 6 plan items…$/);
    const jev = new FakeJev(({ state, key }) => {
      const change = (state as { item: { change: string } }).item.change;
      const requested = /Copy link button|existing src\/lib\/clipboard/.test(change);
      if (key === "necessary") return requested ? 0.9 : 0.1;
      if (key === "requested") return requested ? 0.9 : 0.05;
      if (key === "droppable") return requested ? 0.1 : 0.9;
      return 0.1;
    });
    const out = await checkPlan(EXAMPLE, { jev });
    const text = formatDone(0, EXAMPLE, out, 310, false);
    const [line1, line2] = text.split("\n");
    expect(line1).toMatch(/6 items · keep 2 · simplify 4 · review 0 · 0\.3s$/);
    expect(line2).toMatch(/^simplify Create a generic action registry/);
    expect(line2).toMatch(/ \+1$/);
    expect(line2.split(" · ")).toHaveLength(3);
  });

  it("reports unavailable and invalid plainly", () => {
    expect(formatDone(0, null, { status: "unavailable", results: [], error: "timeout", limitations: [] }, 20000, false)).toMatch(/Jev unavailable \(timeout\)/);
    expect(formatDone(0, null, { status: "invalid", results: [], errors: ["user_request: required"], limitations: [] }, 1, false)).toMatch(/invalid input \(user_request: required\)/);
  });

  it("combine fans out to every observer in order", async () => {
    const seen: string[] = [];
    const obs = combine({ start: () => seen.push("a.start"), done: () => seen.push("a.done") }, { item: () => seen.push("b.item"), done: () => seen.push("b.done") });
    await checkPlan({ user_request: "x", plan_items: [{ id: "1", change: "one thing" }] }, { jev: new FakeJev(), observe: obs });
    expect(seen).toEqual(["a.start", "b.item", "a.done", "b.done"]);
  });
});
