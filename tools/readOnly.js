// Read-only mode (CAUSLY_READ_ONLY=true). Only tools whose permission level is READ stay available;
// every other tool is not registered, is hidden from search_tools, and is refused at the approval gate
// whatever the policy file says. load_toolset is the one exception, so read tools can still be loaded.

import { PERMISSION_LEVELS } from "./security.js";

const ALWAYS_ALLOWED = new Set(["load_toolset"]);

export function readOnlyMode(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.CAUSLY_READ_ONLY ?? "").trim());
}

/** True when the tool may run in read-only mode. A tool with no listed level counts as not READ. */
export function allowedInReadOnly(toolName) {
  return PERMISSION_LEVELS[toolName] === "READ" || ALWAYS_ALLOWED.has(toolName);
}

export function readOnlyRefusal(toolName) {
  return `'${toolName}' is not available: read-only mode is on (CAUSLY_READ_ONLY). Only read tools can run. Unset CAUSLY_READ_ONLY to allow it.`;
}
