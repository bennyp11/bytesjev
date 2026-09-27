import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout this file lives in, so the server finds its own .env when launched from another repository. */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Load `.env` without a dependency: first the checkout's own, then the current
 * directory's (for a repository that keeps its own key). Existing env wins,
 * and the first file to set a variable wins over later ones.
 */
function loadDotEnv(): void {
  for (const dir of [PROJECT_ROOT, process.cwd()]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(dir, ".env"), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
      if (!m) continue;
      const [, key, value] = m;
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
}
loadDotEnv();

const env = (key: string, fallback = ""): string => {
  const v = process.env[key];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
};

export const config = {
  jev: {
    apiKey: env("TYPESAFE_API_KEY"),
    model: env("JEV_MODEL", "jev-latest"),
    cacheDir: resolve(PROJECT_ROOT, ".cache/jev"),
  },
};
