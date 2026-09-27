---
name: bytesjev
description: Check a completed plan for overengineering before editing any file. Use after you have formed a plan for a non-trivial user request and before implementation. Calls the local BytesJev PlanningChecker MCP tool, which asks Jev whether each proposed addition is required by the request, an existing repository convention, or a concrete correctness or security need.
---

# BytesJev: plan check before implementation

BytesJev is an advisory checker. It does not edit, block, or delete anything. You stay responsible for the plan, the code, and the final judgment.

## When to call it

Call `PlanningChecker` exactly once, after you have inspected enough of the repository to form a plan and **before you make the first edit**. Call it when the plan contains at least one decision that goes beyond the literal request: a new abstraction, a new dependency, new configuration, a shared utility, a refactor, or work in adjacent code.

Skip it for trivial requests with no meaningful planning decision (a typo fix, a one-line change the user spelled out exactly).

If you cannot recover the user's original request verbatim, do not call the tool. Never reconstruct or paraphrase the request from your plan.

## What to send

- `user_request`: the user's original request, verbatim.
- `plan_items`: one entry per meaningful proposed addition, each with a stable `id`, the `change` in one or two sentences, and your honest `rationale`. Split "add the button and a registry" into two items. Include the directly requested work too; it anchors the comparison.
- `repo_context`: the conventions, utilities, and constraints you actually observed that bear on these items. Name files and patterns you saw. Do not guess and do not describe conventions you have not verified.

Do not send secrets, `.env` contents, credentials, or unrelated source. The payload is transmitted to the Jev API over the network. Keep context to what the decision needs; the server caps sizes and reports any truncation in `limitations`.

## How to read the result

Each item returns `necessity_score`, `recommendation`, `reason`, `evidence`, and `uncertain`.

- `keep`: the request or a stated constraint supports the item. Proceed.
- `simplify`: nothing submitted requires the item and the remaining items alone would satisfy the request. Remove or narrow it unless you can name a concrete dependency or constraint the tool was not shown.
- `review`: evidence is missing, mixed, or the score is too close to even. Decide yourself. Keep the item only if you can state the concrete present need in one sentence.

The score is Jev's support for the necessity question given what you sent. It is not a verified probability, and false positives are expected. A low score alone is never a directive to delete work; new files, tests, migrations, and error handling are not inherently unnecessary.

Read `limitations`. If it says `repo_context` was missing or truncated, the tool could not credit any item to a repository convention, so a `simplify` on a utility you know the repo uses is a false flag you should override.

## Overriding a flag

You may keep a flagged item. When you keep an item marked `simplify`, or an `uncertain` item you were unsure about, say so in one sentence in your final summary and name the real dependency, constraint, or correctness need. "Might be useful later" is not a justification.

## When the tool is unavailable

On `status: "unavailable"` (timeout, network, missing key) proceed with your plan as normal. Do not retry more than once and do not mention the outage unless the user asks. On `status: "invalid"`, fix the call (the request is missing, an id is duplicated, or an item is blank) and call once more.

## Example

Request: "Add a Copy link button to the article page."

Plan items: (p1) add the button that copies the URL, (p2) generic action registry, (p3) new clipboard dependency, (p4) global feature flag, (p5) reuse the existing clipboard helper.

Expected shape: p1 and p5 `keep`; p2, p3, p4 `simplify` or `review` with reasons quoting your rationale. You then implement p1 with p5 and drop the rest, or keep one of them with a stated concrete reason.
