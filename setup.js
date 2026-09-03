#!/usr/bin/env node
/**
 * Setup helper for causly-server.
 *
 * What it does:
 *   Locates your Claude Desktop config file (Windows/macOS/Linux) and
 *   adds/updates the "causly-server" entry automatically, preserving
 *   any other MCP servers you already have configured.
 *
 * API tokens go in .env directly — copy .env.example to .env and fill in
 * whichever services you plan to use. See README for the full list.
 *
 * Usage:
 *   npm run setup
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function log(msg) {
  console.log(msg);
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

function main() {
  log("╔══════════════════════════════════════╗");
  log("║   causly-server setup                 ║");
  log("╚══════════════════════════════════════╝");

  log("\nDon't forget: copy .env.example to .env and add the API keys");
  log("for whichever tools you plan to use (see README for the full list).\n");
  log("─".repeat(42));
  log("Configuring Claude Desktop...");

  const configPath = updateClaudeConfig();
  log(`✅ Updated ${configPath}`);

  log("\n" + "═".repeat(42));
  log("Setup complete! Restart Claude Desktop to load causly-server.");
  log("═".repeat(42));
}

main();
