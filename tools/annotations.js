import fs from "fs";
import { PERMISSION_LEVELS, ACTION_LEVELS } from "./security.js";

// MCP tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint), derived in one
// place from the permission table. Clients and directories use them to decide how to present and
// approve a tool. They are hints, not enforcement: the approval gate in security.js is what blocks.

// Packs whose tools talk to a service outside this machine.
const OPEN_WORLD_PACKS = new Set([
  "github", "vercel", "supabase", "database", "sentry", "slack", "gmail", "notion", "terraform",
  "research", "leads", "seo", "calendar", "telegram", "linear", "stripe", "discord", "workflow",
]);

// Individual tools that reach outside, in packs that are otherwise local.
const OPEN_WORLD_TOOLS = new Set([
  "run_command", "use_tool", "git_push", "git_pull", "docker_pull", "docker_push", "docker_build", "meeting_transcribe",
]);

// Not DESTRUCTIVE in the permission table, but they overwrite or remove existing state.
const OVERWRITING_TOOLS = new Set([
  "write_file", "edit_file", "move_file", "git_reset", "git_merge", "git_push", "run_command",
  "terraform_apply", "terraform_state_mv", "terraform_state_rm", "secrets_set", "secrets_rotate_key",
  "notion_update_page", "notion_update_block", "supabase_run_sql", "postgres_query", "mysql_query",
  "github_merge_pull_request", "docker_exec",
]);

// Calling twice with the same arguments has the same effect as calling once (only meaningful for
// tools that are not read-only; read-only tools are always reported idempotent).
const IDEMPOTENT_TOOLS = new Set([
  "write_file", "copy_file", "create_directory", "git_init", "git_add", "git_checkout", "secrets_set",
  "docker_start", "docker_stop", "docker_compose_up", "pipeline_update", "github_update_issue",
  "github_update_pull_request", "calendar_update_event", "linear_update_issue", "notion_update_page",
  "notion_update_block", "reminder_update", "meeting_complete_action", "terraform_init", "terraform_fmt",
  "terraform_apply", "terraform_untaint", "load_toolset",
]);

const REMOVES = /(^|_)(delete|remove|destroy|drop)(_|$)/;

let packByTool = null;
function packOf(toolName) {
  if (!packByTool) {
    packByTool = new Map();
    try {
      const manifest = JSON.parse(fs.readFileSync(new URL("../packs/manifest.json", import.meta.url), "utf8"));
      for (const [pack, def] of Object.entries(manifest.packs || {})) for (const t of def.tools) packByTool.set(t.name, pack);
    } catch {
      // No manifest: openWorldHint falls back to the conservative answer below.
    }
  }
  return packByTool.get(toolName) ?? null;
}

// use_tool is rated READ because it only forwards, but it can reach any tool, so it must never
// be presented to a client as read-only.
const FORWARDING_TOOLS = new Set(["use_tool"]);

/** The four annotations for one tool. Every tool gets all four, as booleans. */
export function toolAnnotations(toolName) {
  if (FORWARDING_TOOLS.has(toolName)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  }
  const level = PERMISSION_LEVELS[toolName] || "MEDIUM";
  const readOnly = level === "READ";
  const removes = REMOVES.test(toolName);
  const pack = packOf(toolName);
  const openWorld = OPEN_WORLD_TOOLS.has(toolName) || (pack ? OPEN_WORLD_PACKS.has(pack) : !PERMISSION_LEVELS[toolName]);
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && (level === "DESTRUCTIVE" || removes || Object.hasOwn(ACTION_LEVELS, toolName) || OVERWRITING_TOOLS.has(toolName)),
    idempotentHint: readOnly || removes || IDEMPOTENT_TOOLS.has(toolName),
    openWorldHint: openWorld,
  };
}

/** A tool config with the derived annotations added. Annotations a pack sets itself win. */
export function withAnnotations(toolName, config) {
  return { ...config, annotations: { ...toolAnnotations(toolName), ...(config?.annotations ?? {}) } };
}
