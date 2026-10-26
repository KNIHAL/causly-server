import fs from "fs";
import { z } from "zod";
import { PACKS } from "./registry.js";
import { wrap } from "../tools/toolWrapper.js";

// Per-server state, so tests can use stub servers without sharing anything.
const state = new WeakMap(); // server -> { loading: Map<name, Promise>, loaded: Set<name> }

function stateFor(server) {
  let s = state.get(server);
  if (!s) {
    s = { loading: new Map(), loaded: new Set(), tools: new Map() };
    state.set(server, s);
    if (typeof server.registerTool === "function") {
      const original = server.registerTool.bind(server);
      server.registerTool = (name, config, cb) => {
        s.tools.set(name, { config, cb });
        return original(name, config, cb);
      };
    }
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
      "If your client does not show the new tools, call them with use_tool (tool name plus arguments); no restart is needed. " +
      "To have them in the tool list from the start, run: causly-server toolsets add " +
      result.loaded.join(",");
  }
  if (result.unknown.length) result.available = Object.keys(PACKS);
  return result;
}

function packOfTool(name) {
  for (const [packName, pack] of Object.entries(readManifest().packs || {})) {
    if (pack.tools.some((t) => t.name === name)) return packName;
  }
  return null;
}

function paramType(schema) {
  let def = schema?.def ?? schema?._def;
  while (def && ["optional", "default", "nullable"].includes(def.type) && def.innerType) def = def.innerType.def ?? def.innerType._def;
  return def?.type ?? "value";
}

export function describeParams(shape) {
  const keys = Object.keys(shape || {});
  if (!keys.length) return "(no parameters)";
  return keys
    .map((k) => {
      const v = shape[k];
      const optional = typeof v?.isOptional === "function" && v.isOptional();
      return `- ${k} (${paramType(v)}${optional ? ", optional" : ", required"})${v?.description ? `: ${v.description}` : ""}`;
    })
    .join("\n");
}

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/**
 * Call any tool by name, loading its toolset first when needed. Clients such as Claude Desktop
 * do not refresh their tool list mid-chat, so this works everywhere with no restart.
 * The target tool's own safety checks (workspace, approvals, logging) still run.
 */
export async function useTool(server, { tool, arguments: args, describe }, extra) {
  const s = stateFor(server);
  const name = String(tool || "").trim();
  let entry = s.tools.get(name);
  if (!entry) {
    const packName = packOfTool(name);
    if (!packName) return text(`Unknown tool "${name}". Use search_tools to find the right name.`, true);
    await loadPack(server, packName);
    entry = s.tools.get(name);
  }
  if (!entry) return text(`Tool "${name}" could not be loaded.`, true);
  const schema = entry.config?.inputSchema;
  const shape = schema && typeof schema.safeParse !== "function" ? schema : {};
  if (describe) return text(`${name}: ${entry.config?.description ?? ""}\nParameters:\n${describeParams(shape)}`);
  const parser = schema && typeof schema.safeParse === "function" ? schema : z.object(shape);
  const parsed = parser.safeParse(args ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");
    return text(`Invalid arguments for ${name}: ${problems}\nParameters:\n${describeParams(shape)}`, true);
  }
  return entry.cb(parsed.data, extra);
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

  server.registerTool(
    "use_tool",
    {
      description:
        "Call any tool by name, even one that is not in your tool list yet (its toolset loads automatically). Use this when load_toolset says your client may not show new tools. Set describe=true to see a tool's parameters first.",
      inputSchema: {
        tool: z.string().describe("Tool name, e.g. github_list_issues"),
        arguments: z.record(z.string(), z.any()).optional().describe("The tool's arguments as an object"),
        describe: z.boolean().optional().describe("Only show the tool's parameters, do not run it"),
      },
    },
    (input, extra) => useTool(server, input, extra)
  );
}

export async function initPacks(server) {
  registerMetaTools(server);
  const { names, unknown } = resolveToolsets();
  for (const n of unknown) console.error(`causly-server: unknown toolset "${n}" in CAUSLY_TOOLSETS (ignored)`);
  for (const n of names) await loadPack(server, n);
  console.error(`causly-server: toolsets loaded: ${names.join(", ")}`);
}
