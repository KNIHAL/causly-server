#!/usr/bin/env node
/**
 * Interactive setup wizard for causly-server.
 *
 * What it does:
 *   1. Asks for optional API tokens (GitHub, Vercel, Supabase) and writes
 *      them to .env — skip any you don't need, add them later anytime.
 *   2. Locates your Claude Desktop config file (Windows/macOS/Linux) and
 *      adds/updates the "causly-server" entry automatically, preserving
 *      any other MCP servers you already have configured.
 *
 * Usage:
 *   npm run setup
 */

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, ".env");

// Manual line-queue prompt implementation. Node's readline/promises
// rl.question() is unreliable for sequential questions when stdin isn't a
// real interactive TTY (a known Node issue) — this pattern works in both
// piped and interactive terminals.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lineQueue = [];
const waiters = [];

rl.on("line", (line) => {
  if (waiters.length > 0) waiters.shift()(line);
  else lineQueue.push(line);
});

function ask(promptText) {
  process.stdout.write(promptText);
  return new Promise((resolve) => {
    if (lineQueue.length > 0) resolve(lineQueue.shift().trim());
    else waiters.push((line) => resolve(line.trim()));
  });
}

function log(msg) {
  console.log(msg);
}

async function askToken(label, envKey, helpUrl) {
  log(`\n${label}`);
  log(`  (get one at ${helpUrl} — press Enter to skip)`);
  const value = await ask(`  ${envKey}: `);
  return value;
}

function loadExistingEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, "utf8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

function saveEnv(env) {
  const lines = Object.entries(env)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf8");
}

function getClaudeConfigPath() {
  const platform = os.platform();
  const home = os.homedir();

  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  // Linux and everything else
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

function updateClaudeConfig() {
  const configPath = getClaudeConfigPath();
  const indexPath = path.join(__dirname, "index.js");

  let config = { mcpServers: {} };

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(raw);
      if (!config.mcpServers) config.mcpServers = {};
    } catch (err) {
      log(`\n⚠️  Could not parse existing config at ${configPath} (${err.message}).`);
      log("   A backup will be made before writing a fresh one.");
      fs.copyFileSync(configPath, `${configPath}.backup-${Date.now()}`);
      config = { mcpServers: {} };
    }
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  config.mcpServers["causly-server"] = {
    command: "node",
    args: [indexPath],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

async function main() {
  log("╔══════════════════════════════════════╗");
  log("║   causly-server setup wizard          ║");
  log("╚══════════════════════════════════════╝");

  log("\nFilesystem, git, and shell tools work with no setup at all.");
  log("The steps below are only needed if you want GitHub / Vercel / Supabase tools.\n");
  log("─".repeat(42));

  const env = loadExistingEnv();

  const github = await askToken(
    "GitHub (repos, issues, PRs)",
    "GITHUB_TOKEN",
    "github.com/settings/tokens?type=beta"
  );
  if (github) env.GITHUB_TOKEN = github;

  const vercel = await askToken(
    "Vercel (projects, deployments)",
    "VERCEL_TOKEN",
    "vercel.com/account/tokens"
  );
  if (vercel) env.VERCEL_TOKEN = vercel;

  const supabase = await askToken(
    "Supabase (projects, SQL)",
    "SUPABASE_ACCESS_TOKEN",
    "supabase.com/dashboard/account/tokens"
  );
  if (supabase) env.SUPABASE_ACCESS_TOKEN = supabase;

  const slack = await askToken(
    "Slack (channels, messages)",
    "SLACK_BOT_TOKEN",
    "api.slack.com/apps"
  );
  if (slack) env.SLACK_BOT_TOKEN = slack;

  saveEnv(env);
  log(`\n✅ Saved tokens to ${ENV_PATH}`);

  log("\n" + "─".repeat(42));
  log("Configuring Claude Desktop...");
  const configPath = updateClaudeConfig();
  log(`✅ Updated ${configPath}`);

  log("\n" + "═".repeat(42));
  log("Setup complete! Restart Claude Desktop to load causly-server.");
  log("═".repeat(42));

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  rl.close();
  process.exit(1);
});
