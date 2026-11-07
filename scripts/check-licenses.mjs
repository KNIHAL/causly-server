// Fails when a production dependency has a license outside the allowlist (or no license at all).
// Reads package-lock.json, so it needs no install. Run: npm run check:licenses
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Python-2.0",
  "Unlicense",
]);

/** A license expression passes when every AND part has at least one allowed OR choice. */
export function licenseAllowed(expression) {
  if (typeof expression !== "string" || !expression.trim()) return false;
  return expression
    .replace(/[()]/g, " ")
    .split(/\s+AND\s+/i)
    .every((part) => part.split(/\s+OR\s+/i).some((id) => ALLOWED.has(id.trim())));
}

/** Production packages from a lockfile object: [{ name, version, license }]. */
export function productionPackages(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([key, pkg]) => key && !pkg.dev)
    .map(([key, pkg]) => ({
      name: pkg.name ?? key.replace(/^.*node_modules\//, ""),
      version: pkg.version,
      license: pkg.license,
    }));
}

export function findViolations(lock) {
  return productionPackages(lock).filter((p) => !licenseAllowed(p.license));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const total = productionPackages(lock).length;
  const bad = findViolations(lock);
  if (bad.length) {
    console.error(`License check failed for ${bad.length} of ${total} production packages:`);
    for (const p of bad) console.error(`  ${p.name}@${p.version}: ${p.license ?? "no license field"}`);
    console.error("Allowed: " + [...ALLOWED].join(", "));
    process.exit(1);
  }
  console.log(`License check passed: ${total} production packages, all on the allowlist.`);
}
