import { describe, expect, it } from "vitest";
import type { Message } from "../src/viz/messages.js";
import { createRelay } from "../src/viz/relay.js";

const done = (id: string): Message => ({ type: "done", id, t: 1, status: "ok", limitations: [], ms: 1 });

function fakeFetch(handler: (body: Message, n: number) => number | Error) {
  const seen: Message[] = [];
  const f = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Message;
    const out = handler(body, seen.length);
    seen.push(body);
    if (out instanceof Error) throw out;
    return { ok: out < 400, status: out } as Response;
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe("createRelay", () => {
  it("posts messages one at a time, in order", async () => {
    const { f, seen } = fakeFetch(() => 202);
    const relay = createRelay("http://viz.test/", { fetch: f });
    relay.emit(done("a"));
    relay.emit(done("b"));
    relay.emit(done("c"));
    await relay.done();
    expect(seen.map((m) => (m.type === "done" ? m.id : "?"))).toEqual(["a", "b", "c"]);
    expect(relay.enabled).toBe(true);
  });

  it("switches off after the first connection failure and never throws", async () => {
    const logs: string[] = [];
    const { f, seen } = fakeFetch(() => new Error("ECONNREFUSED"));
    const relay = createRelay("http://viz.test", { fetch: f, log: (l) => logs.push(l) });
    relay.emit(done("a"));
    relay.emit(done("b"));
    await relay.done();
    expect(seen).toHaveLength(1);
    expect(relay.enabled).toBe(false);
    expect(logs.join("\n")).toMatch(/not reachable/);
  });
});
