import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { findShellStringBuilding } from "./helpers/shellScan.js";

// P0-04: no code may build a shell command from text. Use execFile(file, [args]) instead.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles() {
  const dirs = ["tools", "bin", "packs"];
  const files = [path.join(root, "index.js")];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (name.endsWith(".js")) files.push(path.join(root, dir, name));
    }
  }
  return files;
}

describe("shell string scanner", () => {
  const bad = [
    "await exec(`cd '${dir}' && docker compose up`);",
    "execAsync(`git -C ${dir} status`)",
    "execSync('echo ' + name)",
    'execFileAsync("wsl", ["bash", "-lc", `cd \'${dir}\' && ls`])',
    'execFile("cmd", ["/c", "echo " + name])',
    'await execFileAsync("wsl", ["bash", "-lc", composeCmd])',
  ];
  const good = [
    'await execFileAsync("wsl", ["--cd", dir, "--", "docker", "compose", "up"])',
    "db.exec(`VACUUM INTO '${target}'`)",
    "const m = /x/.exec(text)",
    "execAsync(command, runOpts)",
    'execFileAsync(CMD_PATH, ["/d", "/s", "/c", command], runOpts)',
  ];
  for (const snippet of bad) {
    test(`flags: ${snippet}`, () => {
      assert.ok(findShellStringBuilding(snippet).length > 0);
    });
  }
  for (const snippet of good) {
    test(`allows: ${snippet}`, () => {
      assert.deepEqual(findShellStringBuilding(snippet, { allowShellVariable: true }), []);
    });
  }
});

test("no source file builds a shell command from text", () => {
  const problems = [];
  for (const file of sourceFiles()) {
    // run_command is the one tool whose job is to run a shell command the user gave it.
    const found = findShellStringBuilding(fs.readFileSync(file, "utf8"), { allowShellVariable: path.basename(file) === "commandOps.js" });
    for (const f of found) problems.push(`${path.relative(root, file)}:${f.line} ${f.rule}: ${f.text}`);
  }
  assert.deepEqual(problems, []);
});
