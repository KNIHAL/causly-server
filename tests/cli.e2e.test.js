import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(root, "bin", "causly.js");

let dir;
let env;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-e2e-cli-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
  // Everything the CLI could touch is pointed at the temp folder, and the real keys are removed from the environment.
  env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), CAUSLY_HOME: path.join(home, ".causly"), CAUSLY_ENV_FILE: path.join(dir, "settings.env") };
  for (const k of Object.keys(env)) if (/(_TOKEN|_API_KEY|_SECRET|_CHAT_ID)$/.test(k)) delete env[k];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function cli(args, { stdin = "" } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, ...args], { env, cwd: root });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stdout, stderr }));
    p.stdin.end(stdin);
  });
}

describe("causly-server command line", () => {
  it("prints its version and help", async () => {
    expect((await cli(["--version"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const help = await cli(["--help"]);
    expect(help.stdout).toContain("causly-server setup");
    expect(help.stdout).toContain("keys set NAME");
  });

  it("rejects an unknown command", async () => {
    const r = await cli(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Unknown command "frobnicate"/);
  });

  it("keys set / list / unset round trip, without ever printing the key", async () => {
    const secret = "gsk_abcdefghijklmnop1234";
    const set = await cli(["keys", "set", "GROQ_API_KEY"], { stdin: `${secret}\n` });
    expect(set.code).toBe(0);
    expect(set.stdout + set.stderr).not.toContain(secret);
    expect(fs.readFileSync(env.CAUSLY_ENV_FILE, "utf8")).toBe(`GROQ_API_KEY=${secret}\n`);

    const list = await cli(["keys", "list"]);
    expect(list.stdout).toMatch(/GROQ_API_KEY\s+set \(…1234\)/);
    expect(list.stdout).toMatch(/LINEAR_API_KEY\s+missing/);
    expect(list.stdout).not.toContain(secret);

    const unset = await cli(["keys", "unset", "GROQ_API_KEY"]);
    expect(unset.stdout).toMatch(/Removed GROQ_API_KEY/);
    expect(fs.readFileSync(env.CAUSLY_ENV_FILE, "utf8")).not.toContain("GROQ");
  });

  it("keys set refuses a bad name and an empty value", async () => {
    const bad = await cli(["keys", "set", "lowercase"], { stdin: "x\n" });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/capital letters/);
    const empty = await cli(["keys", "set", "GROQ_API_KEY"], { stdin: "\n" });
    expect(empty.code).toBe(1);
    expect(empty.stderr).toMatch(/empty/);
  });

  it("init registers with the detected editor and does not start the key wizard without a terminal", async () => {
    const r = await cli(["init", "--no-setup"]);
    expect(r.code).toBe(0);
    const cfg = JSON.parse(fs.readFileSync(path.join(env.HOME, ".cursor", "mcp.json"), "utf8"));
    expect(cfg.mcpServers["causly-server"].args[0]).toBe(path.join(root, "index.js"));
    expect(r.stdout).toMatch(/Restart Cursor/);
    expect(r.stdout).not.toMatch(/Add API keys now/);

    const removed = await cli(["remove"]);
    expect(removed.stdout).toMatch(/Removed from Cursor/);
  });

  it("init points to setup when there is no terminal to ask in", async () => {
    const r = await cli(["init"]);
    expect(r.stdout).toMatch(/causly-server setup/);
  });

  it("doctor reports the settings and exits non-zero when Node or the settings file is wrong", async () => {
    fs.writeFileSync(env.CAUSLY_ENV_FILE, "GROQ_API_KEY=gsk_abcdefghij\n");
    const r = await cli(["doctor"]);
    expect(r.stdout).toMatch(/ok\s+Node\.js/);
    expect(r.stdout).toMatch(/Integrations configured: Groq/);
    expect(r.stdout).toMatch(/Not set up yet:.*Linear/);
  });

  it("the server still starts with no arguments and answers the MCP handshake", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "cli-test", version: "1" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin], env, stderr: "ignore" }));
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(10);
      expect(tools.tools.some((t) => t.name === "load_toolset")).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);
});
