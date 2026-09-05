# BoundaryAttest server receipts (proof of concept)

This optional adapter adds portable signed evidence for three consequential Causly workflow tools. It does not approve, block, execute, or change a tool call. Causly remains responsible for permission levels, the `confirm: true` gate, secret redaction, path and command protections, execution, workflow behavior, and its JSONL audit log.

The first proof of concept covers only:

- `ship_change`
- `verify_ci_fix`
- `deploy_project`

Blocked, successful, and thrown-error outcomes for those tools can produce receipts. A blocked receipt says `status: "blocked"`; it does not imply that execution occurred. Other tools do not produce receipts. `BOUNDARYATTEST_TOOLS` may narrow the three-tool set, but cannot expand it.

## Trust model and key custody

Receipts use `receipt_role: "server_attested"`: the Causly runtime signs what it says happened at its execution boundary. The private Ed25519 key is loaded from local server configuration only when an eligible receipt is emitted. It is never accepted through an MCP tool schema or returned to the client.

This POC uses an operator-managed PKCS #8 PEM file. It does not generate persistent keys or provide production key storage, rotation, revocation, KMS/HSM integration, or a trust registry. Keep the private key outside the repository and restrict its filesystem permissions.

## Configuration

The feature is off by default. Disabled mode needs no key or receipt directory.

```dotenv
BOUNDARYATTEST_ENABLED=true
BOUNDARYATTEST_PRIVATE_KEY=/absolute/path/to/ed25519-private.pem
BOUNDARYATTEST_RECEIPT_DIR=/absolute/path/to/receipts
BOUNDARYATTEST_TOOLS=ship_change,verify_ci_fix,deploy_project
```

`BOUNDARYATTEST_ENABLED` must be exactly `true`. When enabled, both paths are required. The optional comma-separated allowlist defaults to all three POC tools.

## Receipt and evidence shape

Each file is a BoundaryAttest Interop Profile v0.1 envelope with exactly three top-level fields:

```json
{
  "claim": {
    "receipt_version": "0.1",
    "receipt_role": "server_attested",
    "event_id": "<Causly operation UUID>",
    "timestamp": "<receipt emission time>",
    "action_type": "causly.workflow.<tool name>",
    "status": "success|error|blocked",
    "operation_id": "<same Causly operation UUID>",
    "tool_name": "<tool name>",
    "risk_level": "HIGH",
    "input_hash": "sha256:<hex>",
    "input_representation": "causly.redacted.stable_json.v1"
  },
  "signature": "<base64 Ed25519 signature>",
  "public_key_id": "sha256:<SPKI DER fingerprint>"
}
```

Success claims add `output_hash` and `output_representation`. Error and blocked claims add `error_hash` and `error_representation`. Small workflow references such as a git ref, workflow run ID, deployment ID, project reference, or PR URL are included only when the normal input/result makes them clearly available.

Inputs and successful results are first processed by Causly's existing structured `redactSecrets()` function, then canonicalized with BoundaryAttest v0.1 stable JSON (recursively locale-sorted object keys, preserved array order, compact JSON), UTF-8 encoded, and SHA-256 hashed. This binds the exact canonical **redacted** representation—not the raw request or result. Errors and approval reasons use Causly's string redaction before the same canonicalization and hashing process. Raw requests, results, errors, and secrets are not embedded in receipts.

## Audit correlation and persistence

The central wrapper creates one operation UUID per invocation. It passes that ID to the normal Causly audit record first and then uses the same value for the receipt's `event_id`, `operation_id`, and filename.

Receipts are separate from `logs/activity.log`. Each is written as `<operation_id>.json` with mode `0600` using a temporary file and an atomic, non-overwriting hard-link publication. An existing filename causes receipt emission to fail rather than overwrite evidence.

Receipt creation is not transactional with the workflow. If signing or persistence fails after a successful action and audit write, Causly returns the real successful result and reports a separate `BoundaryAttest error` on stderr. It does not roll back the action, relabel it as failed, or alter authorization behavior.

## Verification

Supply a trusted expected Ed25519 SPKI public key; never trust a key merely because it accompanies a receipt:

```bash
npm run verify:boundaryattest -- /path/to/receipt.json /path/to/expected-public-key.pem
```

The verifier checks JSON parsing, the exact three-field envelope, required claim fields, version `0.1`, role `server_attested`, known SHA-256 field syntax, the expected SPKI-derived key ID, and the Ed25519 signature over the v0.1 canonical claim.

A passing result establishes only structural compatibility, a matching expected key fingerprint, and an unchanged claim signed by that key. It does not establish correct authorization, truthful workflow results, real-world deployment success, runtime integrity, wise approval, secure production key custody, legality, or compliance.
