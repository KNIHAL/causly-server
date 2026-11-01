import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "vitest";
import { runCommand } from "../tools/commandOps.js";

// P0-02 / issue #2: real process, stripped environment, npm lifecycle script that calls `node`.
describe.skipIf(process.platform !== "win32")("runCommand on Windows with a stripped environment", () => {
  let dir;
  let saved;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-postinstall-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "postinstall-fixture",
        version: "1.0.0",
        scripts: { postinstall: "node -e \"require('fs').writeFileSync('ran.txt','ok')\"" },
      })
    );
    saved = { ...process.env };
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    for (const key of Object.keys(process.env)) delete process.env[key];
    process.env.SystemRoot = systemRoot;
    process.env.USERPROFILE = saved.USERPROFILE || os.homedir();
    process.env.TEMP = saved.TEMP || os.tmpdir();
    process.env.PATH = `${systemRoot}\\System32`;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("npm install runs a postinstall script that calls node", async () => {
    const npmCmd = path.join(path.dirname(process.execPath), "npm.cmd");
    const result = await runCommand({
      command: `& '${npmCmd}' install --no-audit --no-fund --offline`,
      cwd: dir,
      timeout_ms: 120_000,
    });
    assert.equal(result.exit_code, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.readFileSync(path.join(dir, "ran.txt"), "utf8"), "ok");
  });
});
