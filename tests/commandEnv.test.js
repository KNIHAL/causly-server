import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { buildWindowsEnv } from "../tools/commandOps.js";

// P0-02 / issue #2: nested cmd.exe (npm lifecycle scripts) must find the same node that runs the server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_EXE = "D:\\tools\\fnm\\node-v22\\node.exe";
const NODE_DIR = "D:\\tools\\fnm\\node-v22";
const HOME = "C:\\Users\\Ünï Köder";

function build(env, extra = {}) {
  return buildWindowsEnv(env, { execPath: NODE_EXE, homedir: () => HOME, ...extra });
}

function pathList(env) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  return env[key].split(";");
}

describe("buildWindowsEnv", () => {
  test("stripped environment gets the running node directory and the npm global dir", () => {
    const env = build({ SystemRoot: "C:\\Windows" });
    const list = pathList(env);
    assert.equal(list[0], NODE_DIR);
    assert.ok(list.includes(`${HOME}\\AppData\\Roaming\\npm`));
  });

  test("uses APPDATA for the npm global dir when present", () => {
    const env = build({ SystemRoot: "C:\\Windows", APPDATA: "D:\\Roam" });
    assert.ok(pathList(env).includes("D:\\Roam\\npm"));
  });

  test("sets ComSpec to the absolute cmd.exe when missing or empty", () => {
    assert.equal(build({ SystemRoot: "C:\\Windows" }).ComSpec, "C:\\Windows\\System32\\cmd.exe");
    assert.equal(build({ SystemRoot: "D:\\WinNT", ComSpec: "" }).ComSpec, "D:\\WinNT\\System32\\cmd.exe");
  });

  test("keeps an existing ComSpec", () => {
    const env = build({ SystemRoot: "C:\\Windows", ComSpec: "C:\\custom\\cmd.exe" });
    assert.equal(env.ComSpec, "C:\\custom\\cmd.exe");
  });

  test("node directory goes first even when an older node is already in PATH", () => {
    const env = build({ SystemRoot: "C:\\Windows", Path: "C:\\old\\node;C:\\Windows\\System32" });
    const list = pathList(env);
    assert.equal(list[0], NODE_DIR);
    assert.ok(list.indexOf("C:\\old\\node") > 0);
  });

  test("no duplicate entries, compared case-insensitively", () => {
    const env = build({ SystemRoot: "C:\\Windows", PATH: `C:\\Windows;${NODE_DIR.toUpperCase()};C:\\Windows` });
    const list = pathList(env).map((p) => p.toLowerCase());
    assert.equal(list.filter((p) => p === NODE_DIR.toLowerCase()).length, 1);
    assert.equal(list.filter((p) => p === "c:\\windows").length, 1);
  });

  test("keeps the original PATH key casing and never creates a second key", () => {
    const env = build({ SystemRoot: "C:\\Windows", Path: "C:\\Windows" });
    assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === "PATH"), ["Path"]);
  });

  test("home comes from the given home directory, never a fixed user", () => {
    const env = build({ SystemRoot: "C:\\Windows" });
    assert.ok(pathList(env).some((p) => p.startsWith(HOME)));
  });

  test("restores PATHEXT without empty segments", () => {
    const env = build({ SystemRoot: "C:\\Windows", PATHEXT: ";.COM" });
    const ext = env.PATHEXT.split(";");
    assert.ok(!ext.includes(""));
    for (const e of [".EXE", ".CMD", ".BAT"]) assert.ok(ext.includes(e));
  });

  test("handles non-ASCII, spaces and a very long PATH", () => {
    const long = Array.from({ length: 500 }, (_, i) => `C:\\dir ${i}\\ünï`).join(";");
    const list = pathList(build({ SystemRoot: "C:\\Windows", PATH: long }));
    assert.equal(list[0], NODE_DIR);
    assert.ok(list.includes("C:\\dir 499\\ünï"));
  });
});

test("commandOps.js contains no user name or fixed Node install directory", () => {
  const source = fs.readFileSync(path.join(root, "tools", "commandOps.js"), "utf8");
  assert.ok(!/nihal/i.test(source), "hard-coded user name");
  assert.ok(!/Program Files\\+nodejs/i.test(source), "hard-coded Node directory");
});
