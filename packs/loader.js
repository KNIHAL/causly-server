import fs from "fs";
import { z } from "zod";
import { PACKS } from "./registry.js";
import { wrap } from "../tools/toolWrapper.js";

// Per-server state, so tests can use stub servers without sharing anything.
const state = new WeakMap(); // server -> { loading: Map<name, Promise>, loaded: Set<name> }

function stateFor(server) {
  let s = state.get(server);
  if (!s) {
    s = { loading: new Map(), loaded: new Set() };
    state.set(server, s);
  }
  return s;
}

let manifestCache = null;
function readManifest() {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  } catch {
    manifestCache = { packs: {} };
  }
  return manifestCache;
}

export function coreToolsets() {
  return Object.keys(PACKS).filter((n) => PACKS[n].core);
}

/**
 * CAUSLY_TOOLSETS="git,github,docker" -> core packs plus those.
 * CAUSLY_TOOLSETS="all" -> every pack. Unset/empty -> core packs only.
 */
export function resolveToolsets(value = process.env.CAUSLY_TOOLSETS) {
  const core = coreToolsets();
  const requested = (value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!requested.length) return { names: core, unknown: [] };
  if (requested.includes("all")) return { names: Object.keys(PACKS), unknown: [] };
  const unknown = requested.filter((n) => !PACKS[n]);
  const known = requested.filter((n) => PACKS[n]);
  return { names: [...new Set([...core, ...known])], unknown };
}

export function isLoaded(server, name) {
  return stateFor(server).loaded.has(name);
}

/** Import a pack and register its tools on the server. Safe to call twice. */
export function loadPack(server, name) {
  const pack = PACKS[name];
  if (!pack) return Promise.reject(new Error(`Unknown toolset: ${name}`));
  const s = stateFor(server);
  if (!s.loading.has(name)) {
    s.loading.set(
      name,
      pack
        .load()
        .then((mod) => {
          mod.default(server);
          s.loaded.add(name);
        })
        .catch((err) => {
          s.loading.delete(name);
          throw err;
        })
    );
  }
  return s.loading.get(name);
}

function toolsetSummary(server) {
  const manifest = readManifest();
  return Object.entries(PACKS).map(([name, pack]) => ({
    name,
    description: pack.description,
    core: pack.core,
    loaded: isLoaded(server, name),
    tool_count: manifest.packs?.[name]?.tools?.length ?? null,
  }));
}

export function searchTools(server, query, limit = 15) {
  const tokens = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return { toolsets: toolsetSummary(server) };

  const manifest = readManifest();
  const scored = [];
  for (const [packName, pack] of Object.entries(manifest.packs || {})) {
    const packText = `${packName} ${pack.description}`.toLowerCase();
    for (const tool of pack.tools) {
      const name = tool.name.toLowerCase();
      const text = `${name} ${tool.description} ${packText}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += 3;
        else if (text.includes(t)) score += 1;
      }
      if (score > 0) {
        scored.push({ score, tool: tool.name, toolset: packName, description: tool.description, loaded: isLoaded(server, packName) });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));
  const matches = scored.slice(0, limit).map(({ score, ...rest }) => rest);
  return { matches, hint: "Use load_toolset with the toolset name to make its tools available." };
}

export async function loadToolsets(server, names) {
  const manifest = readManifest();
  const result = { loaded: [], already_loaded: [], unknown: [], tools_added: [] };
  for (const raw of names) {
    const name = String(raw).trim().toLowerCase();
    if (!PACKS[name]) {
      result.unknown.push(raw);
      continue;
    }
    if (isLoaded(server, name)) {
      result.already_loaded.push(name);
      continue;
    }
    await loadPack(server, name);
    result.loaded.push(name);
    for (const t of manifest.packs?.[name]?.tools || []) result.tools_added.push(t.name);
  }
  if (result.loaded.length) {
    result.note =
      "If your client does not refresh its tool list automatically, set CAUSLY_TOOLSETS=" +
      result.loaded.join(",") +
      " and restart the server.";
  }
  if (result.unknown.length) result.available = Object.keys(PACKS);
  return result;
}

export function registerMetaTools(server) {
  server.registerTool(
    "search_tools",
    {
      description:
        "Find tools by keyword across ALL toolsets, including ones not loaded yet. Call with no query to list every toolset.",
      inputSchema: {
        query: z.string().optional().describe("Keywords, e.g. 'pull request' or 'docker logs'"),
        limit: z.number().optional().describe("Max matches (default 15)"),
      },
    },
    wrap("search_tools", async ({ query, limit }) => searchTools(server, query, limit))
  );

  server.registerTool(
    "load_toolset",
    {
      description:
        "Load one or more toolsets (e.g. 'git', 'github', 'docker') so their tools become available. Use search_tools to discover toolset names.",
      inputSchema: {
        toolsets: z.array(z.string()).describe("Toolset names to load"),
      },
    },
    wrap("load_toolset", async ({ toolsets }) => loadToolsets(server, toolsets))
  );
}

export async function initPacks(server) {
  registerMetaTools(server);
  const { names, unknown } = resolveToolsets();
  for (const n of unknown) console.error(`causly-server: unknown toolset "${n}" in CAUSLY_TOOLSETS (ignored)`);
  for (const n of names) await loadPack(server, n);
  console.error(`causly-server: toolsets loaded: ${names.join(", ")}`);
}
