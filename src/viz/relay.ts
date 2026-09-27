import type { Message } from "./messages.js";

/**
 * Posts a check's messages to the dashboard, in order, one at a time. If the
 * dashboard is not running, the relay switches itself off after the first
 * failure and the check carries on unwatched. It never throws into the check.
 */
export interface Relay {
  readonly url: string;
  readonly enabled: boolean;
  emit(msg: Message): void;
  /** resolves once every queued message has been sent or the relay is off */
  done(): Promise<void>;
}

export function createRelay(
  url: string,
  opts: { fetch?: typeof fetch; log?: (line: string) => void; timeoutMs?: number } = {},
): Relay {
  const doFetch = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const base = url.replace(/\/$/, "");
  let enabled = true;
  let chain: Promise<void> = Promise.resolve();

  const post = async (msg: Message): Promise<void> => {
    const res = await doFetch(`${base}/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  };

  return {
    url: base,
    get enabled() {
      return enabled;
    },
    emit(msg) {
      if (!enabled) return;
      chain = chain
        .then(() => (enabled ? post(msg) : undefined))
        .catch((err: Error) => {
          if (!enabled) return;
          enabled = false;
          log(`dashboard not reachable at ${base} (${err.message}); this check is not streamed`);
        });
    },
    done: () => chain,
  };
}
