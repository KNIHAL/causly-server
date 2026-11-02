import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { checkPackedFiles } from "./helpers/packCheck.js";

// P0-07: the published tarball may only contain the package.json "files" allowlist, and never
// secrets, databases, logs or keys.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

describe("checkPackedFiles (broken fixtures must fail)", () => {
  test.each([
    [".env"],
    ["tools/.env"],
    [".env.production"],
    ["tools/causly.db"],
    ["tools/causly.db-wal"],
    ["logs/activity.log"],
    ["tools/activity.log"],
    ["packs/server.pem"],
    ["bin/id_rsa"],
    ["tools/secrets.enc"],
    [".npmrc"],
    ["tools/credentials.json"],
    [".agent-tests/x.js"],
    ["node_modules/zod/index.js"],
    ["causly-server-1.5.4.tgz"],
  ])("rejects %s", (file) => {
    assert.ok(checkPackedFiles([file], pkg).length > 0, `${file} was not rejected`);
  });

  test("rejects files outside the allowlist", () => {
    const problems = checkPackedFiles(["scripts/agent-smoke.mjs", "tests/a.test.js", "docs/P0.md"], pkg);
    assert.equal(problems.length, 3);
  });

  test("accepts the normal package", () => {
    const good = ["package.json", "README.md", "LICENSE", "CHANGELOG.md", ".env.example", "index.js", "bin/causly.js", "tools/netGuard.js", "packs/manifest.json", "prompts/a.md"];
    assert.deepEqual(checkPackedFiles(good, pkg), []);
  });
});

test("npm pack lists only allowed files", () => {
  const out = execSync("npm pack --dry-run --json --ignore-scripts", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  const files = JSON.parse(out)[0].files.map((f) => f.path.replace(/\\/g, "/"));
  assert.ok(files.includes("index.js") && files.includes("bin/causly.js") && files.includes("packs/manifest.json"), "core files missing from the package");
  assert.deepEqual(checkPackedFiles(files, pkg), []);
  assert.ok(!files.some((f) => f.startsWith("tests/") || f.startsWith("docs/") || f.startsWith("scripts/")));
}, 130_000);
