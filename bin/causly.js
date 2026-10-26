#!/usr/bin/env node
// causly-server command line.
//   causly-server                      start the MCP server (what editors run)
//   causly-server init [options]       set the server up in Claude Desktop, Cursor, Windsurf
//   causly-server status | backup [file] | restore <file>
//   causly-server login google [services]  sign in to Google in the browser
//   causly-server setup [service]      add API keys step by step, with a live check
//   causly-server toolsets [add|remove|reset] [names]   choose what loads at startup
//   causly-server keys <list|set|unset|open>
//   causly-server doctor [--test]      check Node, settings, integrations
//   causly-server remove [--client X]  take it out again
import fs from "fs";
import { PACKAGE_ROOT } from "../tools/paths.js";

const launchEnv = { ...process.env }; // what the editor or terminal started us with; it outranks the settings file
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args[0] : null;
const VALUE_FLAGS = ["--client", "--workspace", "--toolsets"];
const positional = args.slice(1).filter((a, i, rest) => !a.startsWith("--") && !VALUE_FLAGS.includes(rest[i - 1]));

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

const version = () => JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `causly-server ${version()}

Usage:
  causly-server                         Start the MCP server (editors run this)
  causly-server init                    Set up Claude Desktop, Cursor and Windsurf (whichever you have)
      --client claude|cursor|windsurf|all   Pick editors instead of auto-detecting
      --workspace <folder>                  Limit file tools to this folder
      --toolsets <list>                     Load packs at startup, e.g. research,pipeline,meetings
      --no-setup                            Do not offer to add API keys afterwards
  causly-server status                  One screen: editors, keys, pipeline, reminders, backup, updates
  causly-server backup [file]           Save a copy of your pipeline, meetings and reminders
  causly-server restore <file> [--yes]  Put a backup back (the current data is kept as a copy)
  causly-server login google [gmail,calendar,gsc|all]   Sign in to Google in the browser (default: Gmail and Calendar)
  causly-server toolsets                Show which tool packs load at startup
  causly-server toolsets add <names>    Load more packs at startup, e.g. github,calendar
  causly-server toolsets remove <names> Stop loading packs at startup
  causly-server toolsets reset          Back to the default packs
  causly-server setup [service]         Add API keys step by step (checks each one live)
  causly-server keys list               Show which keys are set (never the full value)
  causly-server keys set NAME           Set one key (hidden prompt, or pipe it in)
  causly-server keys unset NAME         Remove a key
  causly-server keys open               Open the settings file in an editor
  causly-server doctor [--test]         Check your setup; --test also checks every key live
  causly-server remove [--client <name>]  Remove it from your editors
  causly-server --version

Keys are stored in ~/.causly/.env (on this computer only).${PACKAGE_ROOT.includes("node_modules") ? "" : " In a git checkout, the .env next to the code is used."}`;

async function main() {
  if (flag("version") || flag("v")) return console.log(version());
  if (flag("help") || flag("h") || command === "help") return console.log(HELP);

  if (command === null) {
    await import("../index.js"); // runs the server over stdio
    return;
  }

  const { loadEnv } = await import("../tools/envLoader.js");
  const ops = await import("../tools/cliOps.js");
  const { createTerminal } = await import("../tools/terminal.js");

  if (command === "init") {
    const r = ops.runInit({ client: flag("client"), workspace: flag("workspace"), toolsets: flag("toolsets") });
    console.log(r.lines.join("\n"));
    console.log(ops.welcomeLines().join("\n"));
    const term = createTerminal();
    try {
      if (term.interactive && !flag("no-setup") && (await term.confirm("\nAdd API keys now?"))) {
        loadEnv();
        const { runSetup } = await import("../tools/setupOps.js");
        await runSetup({ term });
      } else if (!flag("no-setup")) console.log('\nAdd keys any time with: causly-server setup');
    } finally {
      term.close();
    }
  } else if (command === "setup") {
    loadEnv();
    const term = createTerminal();
    try {
      const { runSetup } = await import("../tools/setupOps.js");
      await runSetup({ service: positional[0], term });
    } finally {
      term.close();
    }
  } else if (command === "keys") {
    loadEnv();
    const sub = positional[0];
    const setup = await import("../tools/setupOps.js");
    if (sub === "list" || sub === undefined) console.log(setup.formatKeysList(setup.keysList()));
    else if (sub === "set") {
      const term = createTerminal();
      try {
        const r = await setup.keysSet({ name: positional[1], term, launchEnv });
        console.log(`Saved ${r.name} to ${r.file}.`);
        for (const n of r.notes) console.log(`Note: ${n}`);
      } finally {
        term.close();
      }
    } else if (sub === "unset") {
      const r = setup.keysUnset({ name: positional[1], launchEnv });
      console.log(r.removed ? `Removed ${r.name} from ${r.file}.` : `${r.name} was not in ${r.file}.`);
      for (const n of r.notes) console.log(`Note: ${n}`);
    } else if (sub === "open") {
      const r = setup.keysOpen();
      console.log(`Opening ${r.file}`);
    } else {
      console.error(`Unknown keys command "${sub}". Use: list, set NAME, unset NAME, open.`);
      process.exitCode = 1;
    }
  } else if (command === "status") {
    loadEnv();
    const { runStatus } = await import("../tools/statusOps.js");
    const r = await runStatus({ version: version() });
    console.log(r.lines.join("\n"));
  } else if (command === "backup") {
    const { runBackup } = await import("../tools/backupOps.js");
    const r = await runBackup({ file: positional[0] });
    console.log(`Backup saved: ${r.file} (${Math.max(1, Math.round(r.bytes / 1024))} KB)`);
    console.log("It holds your pipeline, meetings and reminders. API keys are not included (they are in the settings file).");
  } else if (command === "restore") {
    const { runRestore } = await import("../tools/backupOps.js");
    if (!positional[0]) throw new Error("Give the backup file, for example: causly-server restore <file>");
    const term = createTerminal();
    try {
      const ok = flag("yes") || (term.interactive && (await term.confirm("This replaces your current pipeline, meetings and reminders with the backup (a copy of the current data is kept). Continue?", false)));
      if (!ok) throw new Error("Not restored. Add --yes to confirm without a prompt.");
    } finally {
      term.close();
    }
    const r = await runRestore({ file: positional[0] });
    console.log(`Restored ${r.restored}`);
    if (r.safety_copy) console.log(`Your previous data was saved to ${r.safety_copy}`);
    console.log("Restart your editor so running tools reopen the data.");
  } else if (command === "login") {
    if ((positional[0] || "google") !== "google") throw new Error('Only "login google" exists. Other services use: causly-server setup <service>');
    loadEnv();
    const { runGoogleLogin, parseTargets } = await import("../tools/googleLogin.js");
    const term = createTerminal();
    try {
      const r = await runGoogleLogin({ targets: parseTargets(positional.slice(1).join(",")), term });
      if (!r.saved.length || r.checks.some((c) => !c.ok)) process.exitCode = 1;
    } finally {
      term.close();
    }
  } else if (command === "toolsets") {
    const { runToolsets } = await import("../tools/toolsetOps.js");
    const names = positional.slice(1).flatMap((s) => s.split(","));
    const r = runToolsets({ action: positional[0] || "list", names, client: flag("client") });
    console.log(r.lines.join("\n"));
  } else if (command === "remove") {
    console.log(ops.runRemove({ client: flag("client") }).lines.join("\n"));
  } else if (command === "doctor") {
    loadEnv();
    const r = await ops.runDoctor();
    for (const c of r.checks) console.log(`${c.ok ? "ok  " : "warn"}  ${c.name}: ${c.detail}`);
    if (r.not_configured.length) console.log(`\nNot set up yet: ${r.not_configured.join(", ")}`);
    const { checkForUpdate, updateMessage } = await import("../tools/updateCheck.js");
    const update = updateMessage(await checkForUpdate({ current: version() }));
    if (update) console.log(`\n${update}`);
    if (!r.ok) process.exitCode = 1;
    if (flag("test")) {
      const { testConfigured } = await import("../tools/setupOps.js");
      console.log("\nLive checks:");
      const results = await testConfigured();
      if (!results.length) console.log("  nothing to check yet; run: causly-server setup");
      for (const t of results) console.log(`  ${t.ok ? "ok  " : "FAIL"}  ${t.name}: ${t.detail}`);
      if (results.some((t) => !t.ok)) process.exitCode = 1;
    }
  } else {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err?.name === "Cancelled") {
    console.error("\nCancelled.");
    process.exitCode = 130;
  } else {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
});
