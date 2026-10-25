#!/usr/bin/env node
// causly-server command line.
//   causly-server                      start the MCP server (what editors run)
//   causly-server init [options]       set the server up in Claude Desktop, Cursor, Windsurf
//   causly-server remove [--client X]  take it out again
//   causly-server doctor               check Node, settings, integrations
import fs from "fs";
import { PACKAGE_ROOT } from "../tools/paths.js";

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("-") ? args[0] : null;

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
  causly-server remove [--client <name>]  Remove it from your editors
  causly-server doctor                  Check your setup
  causly-server --version

Settings live in ~/.causly/.env (API keys). Docs: ${PACKAGE_ROOT.includes("node_modules") ? "see the README in the package" : "README.md"}`;

async function main() {
  if (flag("version") || flag("v")) return console.log(version());
  if (flag("help") || flag("h") || command === "help") return console.log(HELP);

  if (command === null) {
    await import("../index.js"); // runs the server over stdio
    return;
  }

  const ops = await import("../tools/cliOps.js");
  if (command === "init") {
    const r = ops.runInit({ client: flag("client"), workspace: flag("workspace"), toolsets: flag("toolsets") });
    console.log(r.lines.join("\n"));
  } else if (command === "remove") {
    console.log(ops.runRemove({ client: flag("client") }).lines.join("\n"));
  } else if (command === "doctor") {
    const { loadEnv } = await import("../tools/envLoader.js");
    loadEnv();
    const r = await ops.runDoctor();
    for (const c of r.checks) console.log(`${c.ok ? "ok  " : "warn"}  ${c.name}: ${c.detail}`);
    if (r.not_configured.length) console.log(`\nNot configured yet: ${r.not_configured.join(", ")}`);
    if (!r.ok) process.exitCode = 1;
  } else {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
