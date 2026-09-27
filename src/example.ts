/** The copy-link example from the README: one clearly requested item, one reuse, and four kinds of overreach. */
export const EXAMPLE = {
  user_request: "Add a Copy link button to the article page.",
  repo_context:
    "Article actions live in src/components/ArticleActions.tsx as plain buttons. A shared clipboard helper exists at src/lib/clipboard.ts and is already used by the share menu. No plugin or registry pattern exists for actions. Config is a single src/config.ts with a handful of constants.",
  plan_items: [
    { id: "p1", change: "Add a Copy link button to ArticleActions.tsx that copies the current URL", rationale: "Directly requested" },
    { id: "p2", change: "Create a generic action registry so actions can be registered from anywhere", rationale: "Could support future actions" },
    { id: "p3", change: "Add a copy-to-clipboard npm dependency", rationale: "Handles browser differences" },
    { id: "p4", change: "Add a global config flag to enable or disable the copy-link feature", rationale: "Lets teams turn it off" },
    { id: "p5", change: "Use the existing src/lib/clipboard.ts helper for the copy", rationale: "The repo already uses it for the share menu" },
    { id: "p6", change: "Show a short 'Copied' confirmation after the click", rationale: "The user gets no feedback otherwise" },
  ],
};
