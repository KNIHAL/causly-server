import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { emitBoundaryAttestReceipt, getBoundaryAttestConfig, hashRedacted, verifyBoundaryAttestReceipt } from "../tools/boundaryAttest.js";
import { createToolWrapper } from "../tools/toolWrapper.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-boundaryattest-"));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(dir, "private.pem");
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return {
    dir,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    env: { BOUNDARYATTEST_ENABLED: "true", BOUNDARYATTEST_PRIVATE_KEY: privateKeyPath, BOUNDARYATTEST_RECEIPT_DIR: path.join(dir, "receipts") },
  };
}

test("disabled by default and does not load a key or emit a receipt", () => {
  assert.deepEqual(getBoundaryAttestConfig({}), { enabled: false });
  assert.equal(emitBoundaryAttestReceipt({ toolName: "ship_change", input: {}, result: {}, status: "SUCCESS", operationId: "op-disabled", env: {} }), null);
});

test("enabled selected workflow creates a verifiable receipt", () => {
  const f = fixture();
  const emitted = emitBoundaryAttestReceipt({ toolName: "ship_change", input: { branch_name: "feature" }, result: { ok: true }, status: "SUCCESS", operationId: "op-selected", env: f.env });
  assert.ok(fs.existsSync(emitted.receiptPath));
  assert.deepEqual(Object.keys(emitted.receipt).sort(), ["claim", "public_key_id", "signature"]);
  assert.deepEqual(verifyBoundaryAttestReceipt(JSON.stringify(emitted.receipt), f.publicKeyPem), { ok: true });
});

test("non-selected tools do not emit receipts", () => {
  const f = fixture();
  assert.equal(emitBoundaryAttestReceipt({ toolName: "read_file", input: {}, result: {}, status: "SUCCESS", operationId: "op-read", env: f.env }), null);
  assert.equal(fs.existsSync(f.env.BOUNDARYATTEST_RECEIPT_DIR), false);
});

test("claim tampering fails signature verification", () => {
  const f = fixture();
  const { receipt } = emitBoundaryAttestReceipt({ toolName: "deploy_project", input: { project: "demo" }, result: { ok: true }, status: "SUCCESS", operationId: "op-tamper", env: f.env });
  receipt.claim.status = "error";
  assert.deepEqual(verifyBoundaryAttestReceipt(JSON.stringify(receipt), f.publicKeyPem), { ok: false, reason: "invalid_signature" });
});

test("redacted evidence changes digests but secret values do not", () => {
  assert.notEqual(hashRedacted({ value: "one" }), hashRedacted({ value: "two" }));
  assert.equal(hashRedacted({ api_key: "one", value: 1 }), hashRedacted({ api_key: "two", value: 1 }));
  assert.notEqual(hashRedacted({ api_key: "one", value: 1 }), hashRedacted({ api_key: "one", value: 2 }));
});

test("audit and receipt share the wrapper-owned operation ID", async () => {
  let auditOperationId;
  let receiptOperationId;
  const wrap = createToolWrapper({
    operationIdFactory: () => "op-shared",
    activityLogger: (...args) => { auditOperationId = args[5]; },
    receiptEmitter: ({ operationId }) => { receiptOperationId = operationId; },
  });
  await wrap("ship_change", async () => ({ ok: true }))({ confirm: true });
  assert.equal(auditOperationId, "op-shared");
  assert.equal(receiptOperationId, "op-shared");
});

test("persistence never overwrites an existing operation receipt", () => {
  const f = fixture();
  const args = { toolName: "verify_ci_fix", input: { branch: "main" }, result: { ok: true }, status: "SUCCESS", operationId: "op-once", env: f.env };
  emitBoundaryAttestReceipt(args);
  assert.throws(() => emitBoundaryAttestReceipt(args), /EEXIST/);
});

test("attestation failure does not turn a successful action into an error", async () => {
  const failures = [];
  const wrap = createToolWrapper({
    activityLogger: () => {},
    receiptEmitter: () => { throw new Error("disk full"); },
    attestationErrorReporter: (...args) => failures.push(args),
  });
  const response = await wrap("deploy_project", async () => ({ ok: true }))({ confirm: true });
  assert.equal(response.isError, undefined);
  assert.match(response.content[0].text, /"ok": true/);
  assert.equal(failures.length, 1);
});

test("blocked selected workflows are receipted without executing", async () => {
  let handlerRan = false;
  let evidence;
  const wrap = createToolWrapper({ activityLogger: () => {}, receiptEmitter: (value) => { evidence = value; } });
  const response = await wrap("ship_change", async () => { handlerRan = true; })({});
  assert.equal(handlerRan, false);
  assert.equal(response.isError, true);
  assert.equal(evidence.status, "BLOCKED");
});

test("private key and secrets are absent from receipt and MCP response", async () => {
  const f = fixture();
  const secret = "never-expose-this-private-value";
  const privateKeyPem = fs.readFileSync(f.env.BOUNDARYATTEST_PRIVATE_KEY, "utf8");
  let emitted;
  const wrap = createToolWrapper({
    activityLogger: () => {},
    receiptEmitter: (args) => { emitted = emitBoundaryAttestReceipt({ ...args, env: f.env }); },
  });
  const response = await wrap("ship_change", async () => ({ ok: true }))({ confirm: true, private_key: secret });
  const combined = JSON.stringify(emitted.receipt) + JSON.stringify(response);
  assert.equal(combined.includes(secret), false);
  assert.equal(combined.includes(privateKeyPem), false);
});

test("verifier rejects unexpected envelope fields and malformed hashes", () => {
  const f = fixture();
  const { receipt } = emitBoundaryAttestReceipt({ toolName: "ship_change", input: {}, result: {}, status: "SUCCESS", operationId: "op-shape", env: f.env });
  assert.deepEqual(verifyBoundaryAttestReceipt(JSON.stringify({ ...receipt, extra: true }), f.publicKeyPem), { ok: false, reason: "unexpected_top_level_field:extra" });
  receipt.claim.input_hash = "sha256:nope";
  assert.deepEqual(verifyBoundaryAttestReceipt(JSON.stringify(receipt), f.publicKeyPem), { ok: false, reason: "invalid_hash:input_hash" });
});
