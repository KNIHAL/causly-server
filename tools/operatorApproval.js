// Operator approval. `confirm: true` is an argument the agent chooses, so on its own it cannot tell the
// operator from the agent. When the client supports MCP elicitation, the operator answers a prompt the
// agent cannot answer. Clients without it keep the `confirm: true` flag. An optional policy file
// (~/.causly/policy.json) sets allow / ask / deny per tool or per risk level.

import fs from "fs";
import path from "path";
import { causlyHome } from "./paths.js";
import { getPermissionLevel, redactSecrets, redactSecretsInString } from "./security.js";
import { readOnlyMode, allowedInReadOnly, readOnlyRefusal } from "./readOnly.js";

const DECISIONS = new Set(["allow", "ask", "deny"]);
const LEVELS = new Set(["READ", "LOW", "MEDIUM", "HIGH", "DESTRUCTIVE"]);
const APPROVAL_LEVELS = new Set(["HIGH", "DESTRUCTIVE"]);
const DEFAULT_TIMEOUT_MS = 120_000;

// ---------------- Operator prompt (set by index.js) ----------------

let operatorPrompt = null; // { supported(): boolean, ask(message, timeoutMs): Promise<"accept"|"decline"|"cancel"> }

export function setOperatorPrompt(prompt) {
  operatorPrompt = prompt || null;
}

/** Operator prompt backed by MCP elicitation on the low-level SDK server (`mcpServer.server`). */
export function createElicitationPrompt(lowLevelServer) {
  return {
    supported() {
      const e = lowLevelServer.getClientCapabilities?.()?.elicitation;
      return Boolean(e) && (Object.keys(e).length === 0 || Boolean(e.form));
    },
    async ask(message, timeoutMs) {
      const res = await lowLevelServer.elicitInput(
        { message, requestedSchema: { type: "object", properties: {} } },
        { timeout: timeoutMs }
      );
      return res?.action === "accept" ? "accept" : res?.action === "decline" ? "decline" : "cancel";
    },
  };
}

export function approvalTimeoutMs(env = process.env) {
  const n = Number(env.CAUSLY_APPROVAL_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TIMEOUT_MS;
}

// ---------------- Policy file ----------------

export const policyPath = () => path.join(causlyHome(), "policy.json");

let policyCache = { file: null, mtimeMs: -1, policy: null };

/**
 * Reads ~/.causly/policy.json: { "tools": { "git_push": "allow" }, "levels": { "HIGH": "ask" } }.
 * No file -> { tools: {}, levels: {} }. A file that cannot be read or has a wrong shape returns
 * { invalid: reason }, and approvals then fail closed until it is fixed or removed.
 */
export function loadPolicy() {
  const file = policyPath();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    if (err.code === "ENOENT") return { tools: {}, levels: {} };
    return { invalid: `cannot read ${file}: ${err.code || err.message}` };
  }
  if (policyCache.file === file && policyCache.mtimeMs === stat.mtimeMs) return policyCache.policy;

  let policy;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("top level must be an object");
    const tools = raw.tools ?? {};
    const levels = raw.levels ?? {};
    for (const [section, map, valid] of [["tools", tools, null], ["levels", levels, LEVELS]]) {
      if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error(`"${section}" must be an object`);
      for (const [key, value] of Object.entries(map)) {
        if (!DECISIONS.has(value)) throw new Error(`"${section}.${key}" must be "allow", "ask" or "deny"`);
        if (valid && !valid.has(key)) throw new Error(`"levels.${key}" is not a risk level (READ, LOW, MEDIUM, HIGH, DESTRUCTIVE)`);
      }
    }
    policy = { tools: { ...tools }, levels: { ...levels } };
  } catch (err) {
    policy = { invalid: `${file} is invalid (${err.message})` };
  }
  policyCache = { file, mtimeMs: stat.mtimeMs, policy };
  return policy;
}

/** What the policy says for one call: { decision, level, source }. */
export function decide(toolName, input) {
  const level = getPermissionLevel(toolName, input);
  const policy = loadPolicy();
  if (policy.invalid) {
    // Fail closed: a broken policy file must never loosen anything.
    return APPROVAL_LEVELS.has(level)
      ? { decision: "deny", level, source: "invalid", reason: `${policy.invalid}. Fix or remove the file; ${level}-risk tools are blocked until then.` }
      : { decision: "allow", level, source: "default" };
  }
  if (Object.hasOwn(policy.tools, toolName)) return { decision: policy.tools[toolName], level, source: "policy.tools" };
  if (Object.hasOwn(policy.levels, level)) return { decision: policy.levels[level], level, source: "policy.levels" };
  return { decision: APPROVAL_LEVELS.has(level) ? "ask" : "allow", level, source: "default" };
}

// ---------------- The gate ----------------

function describeCall(toolName, input, level) {
  const { confirm: _confirm, ...rest } = input && typeof input === "object" ? input : {};
  let args = "";
  try {
    args = redactSecretsInString(JSON.stringify(redactSecrets(rest)));
  } catch {
    args = "(arguments could not be shown)";
  }
  if (args.length > 800) args = `${args.slice(0, 800)}... (truncated)`;
  return `The agent wants to run '${toolName}' (${level} risk).\nArguments: ${args}\nAllow this call?`;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Approval for one tool call. Returns { allowed, level, reason? } and never throws.
 * - deny (policy): blocked.
 * - allow (policy, or READ/LOW/MEDIUM by default): runs.
 * - ask: the operator is prompted when the client supports elicitation (the agent's `confirm`
 *   flag does not count), otherwise the call needs `confirm: true`.
 */
export async function resolveApproval(toolName, input) {
  if (readOnlyMode() && !allowedInReadOnly(toolName)) {
    return { allowed: false, level: getPermissionLevel(toolName, input), reason: readOnlyRefusal(toolName) };
  }
  const { decision, level, source, reason } = decide(toolName, input);
  if (decision === "allow") return { allowed: true, level };
  if (decision === "deny") {
    return {
      allowed: false,
      level,
      reason: reason || `'${toolName}' is denied by the operator policy (${policyPath()}).`,
    };
  }

  if (operatorPrompt && operatorPrompt.supported()) {
    const timeoutMs = approvalTimeoutMs();
    let answer;
    try {
      answer = await withTimeout(operatorPrompt.ask(describeCall(toolName, input, level), timeoutMs), timeoutMs);
    } catch (err) {
      return { allowed: false, level, reason: `'${toolName}' needs the operator's approval and the prompt failed (${redactSecretsInString(err?.message || "error")}). Nothing was run.` };
    }
    if (answer === "accept") return { allowed: true, level };
    if (answer === "timeout") {
      return { allowed: false, level, reason: `'${toolName}' needs the operator's approval and no answer came within ${Math.round(timeoutMs / 1000)}s. Nothing was run.` };
    }
    return { allowed: false, level, reason: `The operator declined '${toolName}'. Nothing was run.` };
  }

  // Client without elicitation: the explicit flag stands in for the operator.
  if (input && input.confirm === true) return { allowed: true, level };
  const why = source === "default" ? `is a ${level}-risk action` : `is set to "ask" in the operator policy`;
  return {
    allowed: false,
    level,
    reason: `'${toolName}' ${why} and requires explicit confirmation. Re-call with confirm: true to proceed.`,
  };
}
