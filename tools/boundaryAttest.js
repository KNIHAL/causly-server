import crypto from "crypto";
import fs from "fs";
import path from "path";
import { redactSecrets, redactSecretsInString, PERMISSION_LEVELS } from "./security.js";

export const BOUNDARYATTEST_TOOLS = new Set(["ship_change", "verify_ci_fix", "deploy_project"]);
const REQUIRED_CLAIM_FIELDS = ["receipt_version", "receipt_role", "event_id", "timestamp", "action_type", "status"];
const TOP_LEVEL_FIELDS = ["claim", "signature", "public_key_id"];
const HASH_FIELDS = ["input_hash", "output_hash", "error_hash"];
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function assertUnicode(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError(`${path}: lone high surrogate is not I-JSON`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError(`${path}: lone low surrogate is not I-JSON`);
  }
}

export function compareUtf16(a, b) {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = a.charCodeAt(index) - b.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function canonicalize(value, path, ancestors) {
  if (value === null) return "null";
  if (typeof value === "string") { assertUnicode(value, path); return JSON.stringify(value); }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path}: non-finite number is not JSON`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`${path}: unsupported non-JSON value (${typeof value})`);
  if (ancestors.has(value)) throw new TypeError(`${path}: cyclic value is not JSON`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const elements = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`${path}[${index}]: sparse array holes are unsupported`);
        elements.push(canonicalize(value[index], `${path}[${index}]`, ancestors));
      }
      const extra = Reflect.ownKeys(value).filter((key) => key !== "length" && !(typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
      if (extra.length) throw new TypeError(`${path}: arrays with extra properties are unsupported`);
      return `[${elements.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path}: unsupported non-JSON object type`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) throw new TypeError(`${path}: symbol property keys are unsupported`);
    const members = ownKeys.sort(compareUtf16).map((key) => {
      assertUnicode(key, `${path} property name`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(`${path}.${key}: accessors and non-enumerable properties are unsupported`);
      return `${JSON.stringify(key)}:${canonicalize(descriptor.value, `${path}.${key}`, ancestors)}`;
    });
    return `{${members.join(",")}}`;
  } finally { ancestors.delete(value); }
}

export function jcsCanonicalize(value) {
  return canonicalize(value, "$", new Set());
}

export function hashRedacted(value, { error = false } = {}) {
  const redacted = error ? redactSecretsInString(String(value)) : redactSecrets(value);
  return `sha256:${crypto.createHash("sha256").update(jcsCanonicalize(redacted), "utf8").digest("hex")}`;
}

export function getBoundaryAttestConfig(env = process.env) {
  if (env.BOUNDARYATTEST_ENABLED !== "true") return { enabled: false };
  if (!env.BOUNDARYATTEST_PRIVATE_KEY) throw new Error("BOUNDARYATTEST_PRIVATE_KEY is required when BoundaryAttest is enabled");
  if (!env.BOUNDARYATTEST_RECEIPT_DIR) throw new Error("BOUNDARYATTEST_RECEIPT_DIR is required when BoundaryAttest is enabled");
  const requested = env.BOUNDARYATTEST_TOOLS
    ? env.BOUNDARYATTEST_TOOLS.split(",").map((name) => name.trim()).filter(Boolean)
    : [...BOUNDARYATTEST_TOOLS];
  return {
    enabled: true,
    privateKeyPath: env.BOUNDARYATTEST_PRIVATE_KEY,
    receiptDir: env.BOUNDARYATTEST_RECEIPT_DIR,
    tools: new Set(requested.filter((name) => BOUNDARYATTEST_TOOLS.has(name))),
  };
}

function publicKeyId(publicKey) {
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  return `sha256:${crypto.createHash("sha256").update(spkiDer).digest("hex")}`;
}

function addWorkflowReferences(claim, toolName, input, result) {
  if (toolName === "ship_change") {
    if (input.branch_name) claim.git_ref = input.branch_name;
    if (result?.pull_request?.html_url) claim.target_ref = result.pull_request.html_url;
  } else if (toolName === "verify_ci_fix") {
    if (input.branch) claim.git_ref = input.branch;
    if (result?.run?.id) claim.workflow_run_ref = String(result.run.id);
  } else if (toolName === "deploy_project") {
    if (input.project) claim.target_ref = `vercel_project:${input.project}`;
    if (result?.deployment?.uid) claim.deployment_ref = String(result.deployment.uid);
  }
}

function persistReceipt(receiptDir, eventId, receipt) {
  fs.mkdirSync(receiptDir, { recursive: true });
  const safeEventId = eventId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalPath = path.join(receiptDir, `${safeEventId}.json`);
  const temporaryPath = path.join(receiptDir, `.${safeEventId}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.linkSync(temporaryPath, finalPath);
  } finally {
    try { fs.unlinkSync(temporaryPath); } catch (err) { if (err.code !== "ENOENT") throw err; }
  }
  return finalPath;
}

export function emitBoundaryAttestReceipt({ toolName, input, result, error, status, operationId, timestamp = new Date().toISOString(), env = process.env }) {
  const config = getBoundaryAttestConfig(env);
  if (!config.enabled || !config.tools.has(toolName)) return null;

  const privateKeyPem = fs.readFileSync(config.privateKeyPath, "utf8");
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("BOUNDARYATTEST_PRIVATE_KEY must contain an Ed25519 PKCS #8 private key");
  const publicKey = crypto.createPublicKey(privateKey);
  const claim = {
    receipt_version: "0.2",
    receipt_role: "server_attested",
    event_id: operationId,
    timestamp,
    action_type: `causly.workflow.${toolName}`,
    status: status.toLowerCase(),
    operation_id: operationId,
    tool_name: toolName,
    risk_level: PERMISSION_LEVELS[toolName] || "MEDIUM",
    input_hash: hashRedacted(input),
    input_representation: "causly.redacted.jcs.v1",
  };
  if (status === "SUCCESS") {
    claim.output_hash = hashRedacted(result);
    claim.output_representation = "causly.redacted.jcs.v1";
    addWorkflowReferences(claim, toolName, input, result);
  } else {
    claim.error_hash = hashRedacted(error, { error: true });
    claim.error_representation = "causly.redacted_string.jcs.v1";
  }
  const signature = crypto.sign(null, Buffer.from(jcsCanonicalize(claim), "utf8"), privateKey).toString("base64");
  const receipt = { claim, signature, public_key_id: publicKeyId(publicKey) };
  return { receipt, receiptPath: persistReceipt(config.receiptDir, operationId, receipt) };
}

function fail(reason) { return { ok: false, reason }; }

export function verifyBoundaryAttestReceipt(receiptText, expectedPublicKeyPem) {
  let receipt;
  try { receipt = JSON.parse(receiptText); } catch { return fail("invalid_json"); }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return fail("invalid_receipt");
  for (const field of TOP_LEVEL_FIELDS) if (!(field in receipt)) return fail(`missing_top_level_field:${field}`);
  for (const field of Object.keys(receipt)) if (!TOP_LEVEL_FIELDS.includes(field)) return fail(`unexpected_top_level_field:${field}`);
  if (!receipt.claim || typeof receipt.claim !== "object" || Array.isArray(receipt.claim)) return fail("claim_not_object");
  if (typeof receipt.signature !== "string" || typeof receipt.public_key_id !== "string") return fail("invalid_receipt");
  for (const field of REQUIRED_CLAIM_FIELDS) if (!(field in receipt.claim)) return fail(`missing_claim_field:${field}`);
  if (receipt.claim.receipt_version !== "0.2") return fail("unsupported_version");
  if (receipt.claim.receipt_role !== "server_attested") return fail("unsupported_receipt_role");
  for (const field of HASH_FIELDS) {
    if (field in receipt.claim && receipt.claim[field] !== null && !HASH_PATTERN.test(receipt.claim[field])) return fail(`invalid_hash:${field}`);
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(expectedPublicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519" || receipt.public_key_id !== publicKeyId(publicKey)) return fail("public_key_id_mismatch");
  } catch { return fail("public_key_id_mismatch"); }
  try {
    const signature = Buffer.from(receipt.signature, "base64");
    if (signature.toString("base64") !== receipt.signature || !crypto.verify(null, Buffer.from(jcsCanonicalize(receipt.claim), "utf8"), publicKey, signature)) return fail("invalid_signature");
  } catch { return fail("invalid_signature"); }
  return { ok: true };
}
