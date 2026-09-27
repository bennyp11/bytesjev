import { describe, expect, it } from "vitest";
import { EXAMPLE } from "../src/example.js";
import { checkPlan } from "../src/mcp/planning-checker.js";
import { narrate, type Message } from "../src/viz/messages.js";
import { FakeJev } from "./fake-jev.js";

describe("narrate", () => {
  it("emits one call, one item per plan item as it is judged, then done", async () => {
    const msgs: Message[] = [];
    const jev = new FakeJev(({ key }) => (key === "necessary" ? 0.9 : key === "requested" ? 0.8 : 0.1));
    const out = await checkPlan(EXAMPLE, { jev, observe: narrate((m) => msgs.push(m), { id: "c1", source: "claude-code" }) });
    expect(out.status).toBe("ok");
    expect(msgs[0]).toMatchObject({ type: "call", id: "c1", source: "claude-code", request: EXAMPLE.user_request });
    const call = msgs[0] as Extract<Message, { type: "call" }>;
    expect(call.items.map((i) => i.id)).toEqual(EXAMPLE.plan_items.map((i) => i.id));
    expect(Object.keys(call.questions).sort()).toEqual(["convention", "droppable", "necessary", "requested", "safety", "speculative"]);
    expect(call.questions.necessary.instructions).toMatch(/needed/);
    const items = msgs.filter((m) => m.type === "item") as Array<Extract<Message, { type: "item" }>>;
    expect(items.map((i) => i.itemId).sort()).toEqual(EXAMPLE.plan_items.map((i) => i.id).sort());
    expect(items[0].result.recommendation).toBe("keep");
    expect(items[0].judgment.necessary).toBe(0.9);
    expect(msgs.at(-1)).toMatchObject({ type: "done", id: "c1", status: "ok" });
    expect(msgs).toHaveLength(EXAMPLE.plan_items.length + 2);
  });

  it("reports invalid input as done without a call", async () => {
    const msgs: Message[] = [];
    await checkPlan({ user_request: "x", plan_items: [] }, { jev: new FakeJev(), observe: narrate((m) => msgs.push(m), { source: "page" }) });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ type: "done", status: "invalid" });
  });

  it("reports a missing key as call then done unavailable", async () => {
    const msgs: Message[] = [];
    await checkPlan(EXAMPLE, { jev: null, observe: narrate((m) => msgs.push(m), { source: "page" }) });
    expect(msgs.map((m) => m.type)).toEqual(["call", "done"]);
    expect(msgs[1]).toMatchObject({ type: "done", status: "unavailable", error: "no_api_key" });
  });
});
