import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

// P0-01: direct dependencies must stay on patched versions (see docs/P0.md).
// Offline check of the installed versions; `npm audit --omit=dev --audit-level=high` runs in CI (P0-07).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function installedVersion(name) {
  const file = path.join(root, "node_modules", ...name.split("/"), "package.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).version;
}

function atLeast(version, minimum) {
  const a = version.split("-")[0].split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

const minimums = {
  "simple-git": "4.0.2",
  "@modelcontextprotocol/sdk": "1.32.2",
  zod: "4.6.6",
  "@simple-git/argv-parser": "2.0.1",
  "body-parser": "2.4.0",
};

for (const [name, minimum] of Object.entries(minimums)) {
  test(`${name} is at least ${minimum}`, () => {
    const version = installedVersion(name);
    assert.ok(atLeast(version, minimum), `${name} ${version} is older than ${minimum}`);
  });
}

test("package.json ranges do not allow the vulnerable versions", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const name of ["simple-git", "@modelcontextprotocol/sdk", "zod"]) {
    const floor = pkg.dependencies[name].replace(/^[\^~]/, "");
    assert.ok(atLeast(floor, minimums[name]), `${name} range ${pkg.dependencies[name]} allows versions below ${minimums[name]}`);
  }
});
