import crypto from "crypto";
import { checkApproval } from "./security.js";
import { logActivity } from "./logger.js";
import { emitBoundaryAttestReceipt } from "./boundaryAttest.js";

function reportAttestationFailure(toolName, operationId, err) {
  console.error(`BoundaryAttest error for ${toolName} (${operationId}): ${err.message}`);
}

export function createToolWrapper({
  approvalCheck = checkApproval,
  activityLogger = logActivity,
  receiptEmitter = emitBoundaryAttestReceipt,
  operationIdFactory = () => crypto.randomUUID(),
  attestationErrorReporter = reportAttestationFailure,
} = {}) {
  return function wrap(toolName, handler) {
    return async (input) => {
      const operationId = operationIdFactory();
      const attest = (evidence) => {
        try { receiptEmitter({ toolName, input, operationId, ...evidence }); }
        catch (err) { attestationErrorReporter(toolName, operationId, err); }
      };
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
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    };
  };
}

export const wrap = createToolWrapper();
