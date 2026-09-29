# BytesJev PlanningChecker

A local MCP server for Claude Code that checks a plan for overengineering **after the agent has planned and before it edits anything**.

It takes the user's original request, the agent's proposed plan items, and the repository conventions the agent observed, and asks **Jev** (TypeSafe's System One model) one question per item: is this needed by the request, an existing convention, or a concrete correctness or security need? Each item comes back with a necessity score and an advisory `keep` / `simplify` / `review`. The tool never edits, blocks, or deletes; the agent stays responsible for the plan.

```
user request ─┐
plan items   ─┼─▶ PlanningChecker ─▶ Jev: six yes/no judgments per item ─▶ keep / simplify / review
repo context ─┘                      (code decides; Jev judges)
```

## Why Jev

Jev returns typed answers with calibrated probabilities, in one request that evaluates several questions at once, for about $0.04 per million input tokens. It does not generate text, so it never talks the agent into or out of anything; it only answers the specific necessity questions the code asks, and the code turns those probabilities into a recommendation with thresholds you can read and tune.

## Install

One command, once, from any directory. It asks for your TypeSafe API key (get one at https://typesafe.ai), registers the MCP server with Claude Code for your user, and installs the skill:

```sh
npx -y bytesjev setup
```

The key is stored in Claude Code's own user config, not in any repository. The skill goes to `~/.claude/skills/bytesjev/` and tells Claude Code when to call the tool, what to send, how to treat `review`, and how to justify keeping a flagged item. Run `/mcp` in an open session to reconnect, and the `PlanningChecker` tool is there in every repository you open. Re-run `setup` to change the key; `--key` or `TYPESAFE_API_KEY` in the environment skips the prompt.

By hand, the equivalent is `claude mcp add --scope user bytesjev -e TYPESAFE_API_KEY=your-key -- npx -y bytesjev` followed by `npx -y bytesjev install-skill`.

To share the setup with a team, put `{ "command": "npx", "args": ["-y", "bytesjev"] }` under `mcpServers.bytesjev` in the repository's `.mcp.json` and the skill under its `.claude/skills/bytesjev/`; each developer sets `TYPESAFE_API_KEY` in their own environment.

### See the verdicts under the chat

`setup` also adds a Claude Code status line, so every check shows up beneath the conversation as it happens: first `judging 6 plan items…`, then `keep 2 · simplify 2 · review 2 · 0.3s` with the flagged items named on a second line. The MCP server writes that text to `~/.claude/bytesjev/status.txt` after each check and the status line prints the file; nothing accumulates. If you already have a status line, `setup` leaves it alone and tells you what to append to its command (`npx bytesjev status` prints the same text).

### Watch it judge

```sh
npx bytesjev viz     # then open http://localhost:4310
```

A local page that shows every PlanningChecker call as it happens: the request, each plan item, Jev's six judgments per item drawn as probability meters with the decision threshold as a tick, and the `keep` / `simplify` / `review` code derives from them, with the reason and the quoted evidence. The MCP server posts each call to the page while it runs, so Claude Code in one window and the page in another give a live picture; if the page is not running, nothing changes for the tool. The page can also run the bundled example itself (it needs `TYPESAFE_API_KEY` in its environment or in a `.env` in the current directory). Set `VIZ_URL` if the page is not on `http://localhost:4310`.

## Develop

```sh
git clone https://github.com/bennyp11/bytesjev && cd bytesjev
cp .env.example .env     # put TYPESAFE_API_KEY in it; .env is gitignored
npm install
npm test                 # offline: scripted Jev
npm run smoke:plan       # one live call: the copy-link example below
npm run smoke:mcp        # drives the stdio server the way Claude Code does
npm run viz              # the dashboard from source
```

`.mcp.json` in the checkout runs the server from source (`npx tsx src/mcp/index.ts`), so opening Claude Code in this directory uses your working copy. The server finds the checkout's own `.env` wherever it is launched from. Issues and pull requests are welcome at https://github.com/bennyp11/bytesjev.

### The tool

**Input**

- `user_request`: the user's request, verbatim. Never reconstructed from the plan.
- `plan_items`: one entry per meaningful proposed addition, each with a stable `id`, the `change`, and the agent's honest `rationale`. The directly requested work goes in too; it anchors the comparison.
- `repo_context` (optional): conventions, utilities, and constraints the agent actually observed. Facts, not guesses.

**Output**, one result per item in the order sent, plus `limitations`:

| field | meaning |
|---|---|
| `necessity_score` | Jev's support for "this is needed", in [0, 1]. Not a verified probability; false positives are expected. |
| `recommendation` | `keep`: the request or a stated constraint supports it. `simplify`: nothing submitted requires it **and** the other items alone would satisfy the request. `review`: evidence is missing, mixed, or too close to call; the agent decides. |
| `reason` | one sentence quoting the submitted text that drove the call |
| `evidence` | the submitted sentences it relied on |
| `uncertain` | true for every `review` and for any call near a threshold |

**Example.** Request: "Add a Copy link button to the article page." Plan: (p1) add the button that copies the URL, (p2) a generic action registry, (p3) a new clipboard dependency, (p4) a global feature flag, (p5) reuse the existing clipboard helper. Expected: p1 and p5 `keep`; p2, p3, p4 `simplify` or `review`, each with a reason quoting the rationale.

## How it decides

- **Primitive:** `assessNecessity` in `src/jev/primitives/necessity.ts`. One Jev request per item with six yes/no judgments: `necessary`, `requested`, `convention` (only when context was given), `safety`, `speculative`, and `droppable` (only with other items: "would the rest of the plan alone satisfy the request?"). That last one is what makes `simplify` concrete: the smaller path is the plan minus this item.
- **Policy:** `decide` in `src/mcp/planning-checker.ts`. `keep` at necessity ≥ 0.65, or when the request or a stated convention supports the item at ≥ 0.7. `simplify` only below 0.35 **and** droppable **and** no requested / convention / safety signal at ≥ 0.5 **and** more than one item. Everything else, including the mid-band and conflicting signals, is `review` with `uncertain: true`. Reasons quote submitted text chosen by word overlap; nothing about the repository is invented.
- **Fail open:** a missing key, timeout, network, auth, or rate-limit error returns `status: "unavailable"` with an empty `results` array and a short error category, and the agent proceeds with its plan. Invalid input returns `status: "invalid"` with messages, never invented results.
- **Limits:** 25 items, 4,000 characters of request, 8,000 of context. Truncation is reported in `limitations`.

## Privacy

The key is read from `TYPESAFE_API_KEY` (or `.env`) and never logged or echoed. Only the request, the plan items, and the context are sent to the Jev API; the skill tells the agent not to include secrets or unrelated source. Nothing is written to disk unless `BYTESJEV_CACHE=1`. `BYTESJEV_DEBUG=1` prints one stderr line per call with the status, item count, and milliseconds.

## Layout

```
src/cli.ts                     `bytesjev` binary: mcp (default) | viz | install-skill
src/mcp/index.ts               stdio entry point
src/mcp/server.ts              the PlanningChecker tool: schema, description, logging
src/mcp/planning-checker.ts    validation, limits, the decision policy, reasons
src/jev/primitives/necessity.ts  the six Jev questions per item
src/jev/client.ts              Jev client with timeouts, usage accounting, optional cache
src/viz/                       the live dashboard: server, page, the messages the MCP server relays
src/example.ts                 the copy-link example used by the smoke test and the page
.claude/skills/bytesjev/       the Claude Code skill
test/                          offline tests with a scripted Jev
scripts/                       live smoke tests
```

## License

MIT. See `LICENSE`.
