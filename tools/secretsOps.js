import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { dataDir } from "./paths.js";
import { assertPathAllowed } from "./pathGuard.js";
import { writeFileAtomic } from "./privateFiles.js";
import { isInsideRoot, workspaceRoots } from "./workspace.js";

const ALGO = "aes-256-gcm";
// Fixed folder (the repo in a checkout, ~/.causly when installed from npm), whatever directory the server was launched from.
const DEFAULT_STORE_PATH = path.join(dataDir(), ".causly-secrets.enc");

// Exactly 64 hex characters. Buffer.from(x, "hex") alone is not enough: it stops at the first invalid
// character, so "<64 hex>zz" would be accepted as a valid 32-byte key.
export function parseKey(hex, label) {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${label} must be a 32-byte value encoded as a 64-character hex string.`);
  }
  return Buffer.from(hex, "hex");
}

function getMasterKey() {
  const key = process.env.SECRETS_MASTER_KEY;
  if (!key) {
    throw new Error(
      "SECRETS_MASTER_KEY not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and add it to your .env file."
    );
  }
  return parseKey(key, "SECRETS_MASTER_KEY");
}

/**
 * The default store, or a custom store_path that sits inside Causly's data folder or a CAUSLY_WORKSPACE
 * folder. Without this, an agent could point the store at any file the user can write (and a successful
 * write replaces that file).
 */
function storePath(store_path, access = "read") {
  if (!store_path) return DEFAULT_STORE_PATH;
  assertPathAllowed(store_path, access); // protected folders (credentials, system directories) are refused first
  const roots = [dataDir(), ...workspaceRoots()];
  if (!roots.some((root) => isInsideRoot(root, store_path))) {
    throw new Error(
      `store_path "${store_path}" is outside the folders Causly keeps secrets in (its data folder and CAUSLY_WORKSPACE). Leave store_path out to use the default store.`
    );
  }
  return path.resolve(store_path);
}

// An existing file is only used as a store if every entry looks like one, so a custom store_path can
// never read or overwrite some other JSON file (a package.json, a config).
function assertLooksLikeStore(data, p) {
  const ok =
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.values(data).every((e) => e && typeof e.iv === "string" && typeof e.data === "string" && typeof e.tag === "string");
  if (!ok) throw new Error(`${p} is not a Causly secrets store, so it was left untouched.`);
  return data;
}

async function loadStore(store_path, access = "read") {
  const p = storePath(store_path, access);
  try {
    const raw = await fs.readFile(p, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${p} is not a Causly secrets store, so it was left untouched.`);
    }
    return assertLooksLikeStore(parsed, p);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function saveStore(store_path, data) {
  const p = storePath(store_path, "write");
  // Temporary file + rename, owner-only: a crash can never leave half a secrets file.
  writeFileAtomic(p, JSON.stringify(data, null, 2), { mkdir: !store_path });
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
  const store = await loadStore(store_path, "write");
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
  const store = await loadStore(store_path, "write");
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
  const newKey = parseKey(newKeyHex, "SECRETS_MASTER_KEY_NEW");

  const store = await loadStore(store_path, "write");
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
