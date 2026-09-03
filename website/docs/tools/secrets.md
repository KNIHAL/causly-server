---
sidebar_position: 7
---

# Secrets manager

6 tools for a local, encrypted secrets store — no external vault service required. Implemented
in `tools/secretsOps.js`.

## Why local instead of Vault/AWS Secrets Manager

This server is designed to work identically no matter what you're hosting on — a local encrypted
file has no dependency on which cloud (or no cloud) your project lives on, and there's nothing
extra to provision or pay for.

## Setup

Generate a master key and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
SECRETS_MASTER_KEY=<the generated hex string>
```

Secrets are stored AES-256-GCM encrypted in `.causly-secrets.enc` at the repo root (already in
`.gitignore` — never commit this file).

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `secrets_set` | HIGH | Store an encrypted secret by name |
| `secrets_get` | READ | Retrieve and decrypt a secret by name |
| `secrets_list` | READ | List secret names (never values) |
| `secrets_delete` | DESTRUCTIVE | Delete a secret |
| `secrets_rotate_key` | HIGH | Re-encrypt every secret under a new master key |
| `secrets_generate_key` | READ | Generate a new random 32-byte key |

## Rotating the master key

1. `secrets_generate_key` to get a new key
2. Add it to `.env` as `SECRETS_MASTER_KEY_NEW`
3. Restart the server (so it picks up the new env var)
4. Call `secrets_rotate_key` — every stored secret is re-encrypted under the new key
5. Replace `SECRETS_MASTER_KEY` with the new key's value, remove `SECRETS_MASTER_KEY_NEW`
6. Restart again

This exact flow was live-tested end to end, including verifying decryption still works correctly
after rotation.
