import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load `.env` from the project root without a dependency. Existing env wins. */
function loadDotEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
      if (!m) continue;
      const [, key, value] = m;
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env is fine */
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
    cacheDir: resolve(process.cwd(), ".cache/jev"),
  },
};
