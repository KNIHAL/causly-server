// "Is there a newer version?" Asked only by `status` and `doctor`, never while the server runs.
// One small request to the npm registry, remembered for a day. Turn it off with CAUSLY_UPDATE_CHECK=off.
import fs from "fs";
import path from "path";
import { causlyHome } from "./paths.js";

const num = (v) => String(v).replace(/^v/, "").split("-")[0].split(".").map((n) => Number(n) || 0);

/** > 0 when a is newer than b. */
export function compareVersions(a, b) {
  const x = num(a);
  const y = num(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

export async function checkForUpdate({
  current,
  name = "causly-server",
  fetch: fetchFn = globalThis.fetch,
  env = process.env,
  cacheFile = path.join(causlyHome(), ".update-check.json"),
  now = Date.now,
  maxAgeMs = 24 * 3_600_000,
} = {}) {
  if (String(env.CAUSLY_UPDATE_CHECK || "").toLowerCase() === "off") return null;

  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (cached.latest && now() - cached.checked_at < maxAgeMs) {
      return { current, latest: cached.latest, newer: compareVersions(cached.latest, current) > 0 };
    }
  } catch {
    // no cache yet
  }

  try {
    const res = await fetchFn(`https://registry.npmjs.org/${name}/latest`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null; // not published yet, or no network
    const { version } = await res.json();
    if (!version) return null;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ latest: version, checked_at: now() }));
    } catch {
      // the cache is optional
    }
    return { current, latest: version, newer: compareVersions(version, current) > 0 };
  } catch {
    return null;
  }
}

export const updateMessage = (r) =>
  r?.newer ? `A newer version is available: ${r.current} -> ${r.latest}. Update with: npm install -g causly-server@latest (then restart your editor).` : null;
