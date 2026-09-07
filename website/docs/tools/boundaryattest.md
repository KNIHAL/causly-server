# BoundaryAttest Server Receipts

## Introduction

BoundaryAttest provides signed, portable evidence of actions performed at a trusted server-side execution boundary.

In Causly Server, an MCP client can request an operation such as a code change, CI verification, or deployment. Causly applies its existing permission and approval controls, executes the operation, and can optionally produce a cryptographically signed receipt describing what the Causly runtime claims happened.

The receipt is **server-attested**: it is signed by a key controlled by the Causly server operator, rather than by the MCP client.

BoundaryAttest does not replace Causly's authorization, execution, or audit systems. It adds a verifiable cryptographic layer to selected workflow operations.

## How It Works

The POC follows this flow:

```text
MCP Client
    │
    │ request operation
    ▼
Causly Server
    │
    ├── permission checks
    ├── approval gates
    ├── secret redaction
    └── execution
    │
    ▼
Workflow Result
    │
    └── optional BoundaryAttest receipt
             │
             ├── redacted evidence hashes
             ├── operation ID
             ├── server-attested claim
             └── Ed25519 signature
```

The receipt is generated after the normal Causly workflow has established its outcome. BoundaryAttest does not approve, block, execute, or otherwise change a tool call.

## Proof-of-Concept Scope

The first Causly integration covers three consequential workflow tools:

* `ship_change`
* `verify_ci_fix`
* `deploy_project`

Blocked, successful, and thrown-error outcomes for these tools can produce receipts.

A blocked receipt indicates that the operation was blocked; it does not imply that execution occurred.

Other tools do not produce receipts. `BOUNDARYATTEST_TOOLS` may narrow the three-tool set, but cannot expand it.

## Trust Model and Key Custody

Receipts use:

```text
receipt_role: "server_attested"
```

This means the Causly runtime signs what it claims happened at its execution boundary.

The private Ed25519 key is loaded from local server configuration only when an eligible receipt is emitted. It is never accepted through an MCP tool schema or returned to the client.

The POC uses an operator-managed PKCS #8 PEM file.

It does **not** provide:

* Persistent key generation
* Production key storage
* Key rotation
* Key revocation
* KMS/HSM integration
* A trust registry

The private key must remain outside the repository and its filesystem permissions should be restricted appropriately.

## Configuration

BoundaryAttest is disabled by default.

Disabled mode requires no key or receipt directory.

```dotenv
BOUNDARYATTEST_ENABLED=true
BOUNDARYATTEST_PRIVATE_KEY=/absolute/path/to/ed25519-private.pem
BOUNDARYATTEST_RECEIPT_DIR=/absolute/path/to/receipts
BOUNDARYATTEST_TOOLS=ship_change,verify_ci_fix,deploy_project
```

`BOUNDARYATTEST_ENABLED` must be exactly `true`.

When enabled, the private-key and receipt-directory paths are required. The optional comma-separated tool allowlist defaults to all three POC tools.

## Receipt Format

Each receipt is a BoundaryAttest Interop Profile v0.2 envelope with exactly three top-level fields.

BoundaryAttest v0.1 remains a frozen legacy profile. Causly uses v0.2 for language-neutral RFC 8785 / JCS canonicalization.

```json
{
  "claim": {
    "receipt_version": "0.2",
    "receipt_role": "server_attested",
    "event_id": "<Causly operation UUID>",
    "timestamp": "<receipt emission time>",
    "action_type": "causly.workflow.<tool name>",
    "status": "success|error|blocked",
    "operation_id": "<same Causly operation UUID>",
    "tool_name": "<tool name>",
    "risk_level": "HIGH",
    "input_hash": "sha256:<hex>",
    "input_representation": "causly.redacted.jcs.v1"
  },
  "signature": "<base64 Ed25519 signature>",
  "public_key_id": "sha256:<SPKI DER fingerprint>"
}
```

Successful claims additionally contain:

```text
output_hash
output_representation
```

Error and blocked claims additionally contain:

```text
error_hash
error_representation
```

Small workflow references, such as a Git ref, workflow run ID, deployment ID, project reference, or PR URL, are included only when the normal input or result makes them clearly available.

## Canonicalization and Evidence

Inputs and successful results are first processed by Causly's existing structured `redactSecrets()` function.

The redacted representation is then:

1. Canonicalized using RFC 8785 / JCS
2. UTF-8 encoded
3. SHA-256 hashed

This binds the exact canonical **redacted** representation rather than the raw request or result.

Errors and approval reasons use Causly's string redaction before the same canonicalization and hashing process.

Raw requests, results, errors, and secrets are not embedded in receipts.

## Audit Correlation and Persistence

The central Causly wrapper creates one operation UUID per invocation.

That same identifier is used for:

* The normal Causly audit record
* The receipt `event_id`
* The receipt `operation_id`
* The receipt filename

Receipts are stored separately from:

```text
logs/activity.log
```

Each receipt is written as:

```text
<operation_id>.json
```

with filesystem mode `0600`.

Receipt publication uses a temporary file and an atomic, non-overwriting hard-link operation. If an existing filename is encountered, receipt emission fails rather than overwriting existing evidence.

## Failure Handling

Receipt creation is not transactional with the workflow.

If signing or persistence fails after a successful action and audit write:

* Causly returns the real successful result.
* A separate `BoundaryAttest error` is reported on stderr.
* The workflow is not rolled back.
* The action is not relabeled as failed.
* Authorization behavior is not changed.

BoundaryAttest therefore remains an additional evidence layer rather than a dependency of the underlying workflow execution.

## Verification

Verification requires a trusted expected Ed25519 SPKI public key.

```bash
npm run verify:boundaryattest -- /path/to/receipt.json /path/to/expected-public-key.pem
```

A verifier must not trust a public key merely because it accompanies a receipt.

The verifier checks:

* JSON parsing
* The exact three-field envelope
* Required claim fields
* Receipt version `0.2`
* `server_attested` role
* Known SHA-256 field syntax
* Expected SPKI-derived key ID
* Ed25519 signature over the RFC 8785 / JCS canonical claim

A successful verification establishes structural compatibility, a matching expected key fingerprint, and an unchanged claim signed by that key.

## Interoperability

BoundaryAttest v0.2 uses RFC 8785 / JSON Canonicalization Scheme (JCS) to provide deterministic, language-independent canonicalization.

This is important because the receipt format is intended to be independently verifiable across implementations and programming languages.

The BoundaryAttest v0.2 interoperability vectors cover:

* Mixed-case keys
* Numeric-looking keys
* Unicode
* Nested objects
* Arrays
* Escaped characters
* Number serialization

The vectors are independently validated in JavaScript and Python, with Causly's focused suite validating the copied vectors under Node.js.

BoundaryAttest v0.1 remains frozen for legacy verification. New Causly receipts use v0.2.

## Security Considerations and Limitations

A valid receipt does not, by itself, prove that the underlying workflow was authorized correctly or that the claimed result is truthful.

A passing verification does **not** establish:

* Correct authorization
* Truthfulness of workflow results
* Real-world deployment success
* Runtime integrity
* Quality of the approval decision
* Secure production key custody
* Legality
* Regulatory or compliance status

The POC also does not provide production-grade key management, rotation, revocation, KMS/HSM integration, or a distributed trust registry.

These are intentionally outside the scope of the current proof of concept.

## Causly Integration

BoundaryAttest is integrated into Causly as an optional adapter around selected workflow operations.

Causly remains responsible for:

* Permission levels
* `confirm: true` approval gates
* Secret redaction
* Path and command protections
* Workflow execution
* Normal workflow behavior
* JSONL audit logging

BoundaryAttest adds signed evidence without changing these existing security or execution semantics.

## Status

This integration is an experimental proof of concept.

The current implementation is intended to validate the trust model, receipt structure, signing flow, canonicalization, and cross-language interoperability before considering broader production requirements.

Future work may include stronger key custody, rotation and revocation mechanisms, trust registries, and distributed receipt persistence.
