import crypto from "crypto";
import { checkApproval } from "./security.js";
import { logActivity } from "./logger.js";
import { checkWorkspace } from "./workspace.js";
import { emitBoundaryAttestReceipt } from "./boundaryAttest.js";
import { reloadEnvIfChanged } from "./envLoader.js";
import { setupHint } from "./services.js";

function reportAttestationFailure(toolName, operationId, err) {
  console.error(`BoundaryAttest error for ${toolName} (${operationId}): ${err.message}`);
}

export function createToolWrapper({
  approvalCheck = checkApproval,
  workspaceCheck = checkWorkspace,
  activityLogger = logActivity,
  receiptEmitter = emitBoundaryAttestReceipt,
  operationIdFactory = () => crypto.randomUUID(),
  attestationErrorReporter = reportAttestationFailure,
  envRefresher = reloadEnvIfChanged,
  errorHinter = setupHint,
} = {}) {
  return function wrap(toolName, handler) {
    return async (input) => {
      try { envRefresher(); } catch { /* a settings-file problem must never block a tool */ }
      const operationId = operationIdFactory();
      const attest = (evidence) => {
        try { receiptEmitter({ toolName, input, operationId, ...evidence }); }
        catch (err) { attestationErrorReporter(toolName, operationId, err); }
      };
      const workspace = workspaceCheck(toolName, input);
      if (!workspace.allowed) {
        activityLogger(toolName, input, "BLOCKED", workspace.reason, null, operationId);
        attest({ status: "BLOCKED", error: workspace.reason });
        return { content: [{ type: "text", text: `Blocked: ${workspace.reason}` }], isError: true };
      }
      const approval = approvalCheck(toolName, input);
      if (!approval.allowed) {
        activityLogger(toolName, input, "BLOCKED", approval.reason, null, operationId);
        attest({ status: "BLOCKED", error: approval.reason });
        return { content: [{ type: "text", text: `Blocked: ${approval.reason}` }], isError: true };
      }
      const startedAt = Date.now();
      try {
        const result = await handler(input);
        activityLogger(toolName, input, "SUCCESS", "", Date.now() - startedAt, operationId);
        attest({ status: "SUCCESS", result });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        activityLogger(toolName, input, "ERROR", err.message, Date.now() - startedAt, operationId);
        attest({ status: "ERROR", error: err.message });
        let hint = null;
        try { hint = errorHinter(err.message); } catch { /* hint is optional */ }
        return { content: [{ type: "text", text: `Error: ${err.message}${hint ? `\n${hint}` : ""}` }], isError: true };
      }
    };
  };
}

export const wrap = createToolWrapper();
