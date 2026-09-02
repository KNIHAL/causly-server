import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ALGO = "aes-256-gcm";
// Anchor the default store to the repo root (one level up from tools/),
// regardless of what directory the server process was launched from.
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_STORE_PATH = path.join(REPO_ROOT, ".causly-secrets.enc");

function getMasterKey() {
  const key = process.env.SECRETS_MASTER_KEY;
  if (!key) {
    throw new Error(
      "SECRETS_MASTER_KEY not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and add it to your .env file."
    );
  }
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("SECRETS_MASTER_KEY must be a 32-byte value encoded as a 64-character hex string.");
  }
  return buf;
}

function storePath(store_path) {
  return store_path || DEFAULT_STORE_PATH;
}

async function loadStore(store_path) {
  const p = storePath(store_path);
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function saveStore(store_path, data) {
  const p = storePath(store_path);
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: authTag.toString("hex"),
  };
}

function decrypt(entry, key) {
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(entry.iv, "hex"));
  decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(entry.data, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Store an encrypted secret by name. HIGH risk — requires confirm: true. */
export async function secretsSet({ name, value, store_path, confirm }) {
  const key = getMasterKey();
  const store = await loadStore(store_path);
  store[name] = {
    ...encrypt(value, key),
    updated_at: new Date().toISOString(),
  };
  await saveStore(store_path, store);
  return { name, saved: true };
}

/** Retrieve and decrypt a secret by name. */
export async function secretsGet({ name, store_path }) {
  const key = getMasterKey();
  const store = await loadStore(store_path);
  const entry = store[name];
  if (!entry) throw new Error(`Secret "${name}" not found.`);
  return { name, value: decrypt(entry, key), updated_at: entry.updated_at };
}

/** List secret names in the store (never returns values). */
export async function secretsList({ store_path }) {
  const store = await loadStore(store_path);
  return {
    secrets: Object.entries(store).map(([name, entry]) => ({ name, updated_at: entry.updated_at })),
  };
}

/** Delete a secret by name. DESTRUCTIVE — requires confirm: true. */
export async function secretsDelete({ name, store_path, confirm }) {
  const store = await loadStore(store_path);
  if (!(name in store)) throw new Error(`Secret "${name}" not found.`);
  delete store[name];
  await saveStore(store_path, store);
  return { name, deleted: true };
}

/**
 * Re-encrypt every secret in the store under a new master key.
 * Call this AFTER setting SECRETS_MASTER_KEY_NEW in your environment.
 * On success, replace SECRETS_MASTER_KEY with the new key's value and remove SECRETS_MASTER_KEY_NEW.
 * HIGH risk — requires confirm: true.
 */
export async function secretsRotateKey({ store_path, confirm }) {
  const oldKey = getMasterKey();
  const newKeyHex = process.env.SECRETS_MASTER_KEY_NEW;
  if (!newKeyHex) {
    throw new Error(
      "SECRETS_MASTER_KEY_NEW not set. Generate a new key and add it to your .env before rotating."
    );
  }
  const newKey = Buffer.from(newKeyHex, "hex");
  if (newKey.length !== 32) {
    throw new Error("SECRETS_MASTER_KEY_NEW must be a 32-byte value encoded as a 64-character hex string.");
  }

  const store = await loadStore(store_path);
  const rotated = {};
  for (const [name, entry] of Object.entries(store)) {
    const plaintext = decrypt(entry, oldKey);
    rotated[name] = { ...encrypt(plaintext, newKey), updated_at: entry.updated_at };
  }
  await saveStore(store_path, rotated);
  return { rotated_count: Object.keys(rotated).length, note: "Now replace SECRETS_MASTER_KEY with SECRETS_MASTER_KEY_NEW's value in your .env, and remove SECRETS_MASTER_KEY_NEW." };
}

/** Generate a new random 32-byte master key (hex-encoded) — use to initialize SECRETS_MASTER_KEY or for rotation. */
export async function secretsGenerateKey() {
  return { key: crypto.randomBytes(32).toString("hex") };
}
