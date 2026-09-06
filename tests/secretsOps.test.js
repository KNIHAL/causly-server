import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  secretsSet,
  secretsGet,
  secretsList,
  secretsDelete,
  secretsRotateKey,
  secretsGenerateKey,
} from "../tools/secretsOps.js";

let storePath;

beforeAll(() => {
  process.env.SECRETS_MASTER_KEY = crypto.randomBytes(32).toString("hex");
});

beforeEach(async () => {
  storePath = path.join(os.tmpdir(), `causly-secrets-test-${Date.now()}-${Math.random()}.enc`);
});

afterEach(async () => {
  await fs.rm(storePath, { force: true });
  delete process.env.SECRETS_MASTER_KEY_NEW;
});

describe("secretsOps", () => {
  it("generates a valid 32-byte hex key", async () => {
    const { key } = await secretsGenerateKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sets and gets a secret", async () => {
    await secretsSet({ name: "API_KEY", value: "supersecret", store_path: storePath, confirm: true });
    const result = await secretsGet({ name: "API_KEY", store_path: storePath });
    expect(result.value).toBe("supersecret");
    expect(result.name).toBe("API_KEY");
    expect(result.updated_at).toBeTruthy();
  });

  it("throws when getting a nonexistent secret", async () => {
    await expect(secretsGet({ name: "NOPE", store_path: storePath })).rejects.toThrow(/not found/i);
  });

  it("lists secrets without exposing values", async () => {
    await secretsSet({ name: "A", value: "1", store_path: storePath, confirm: true });
    await secretsSet({ name: "B", value: "2", store_path: storePath, confirm: true });
    const { secrets } = await secretsList({ store_path: storePath });
    expect(secrets).toHaveLength(2);
    expect(secrets.map((s) => s.name).sort()).toEqual(["A", "B"]);
    expect(secrets.every((s) => !("value" in s))).toBe(true);
  });

  it("deletes a secret", async () => {
    await secretsSet({ name: "TEMP", value: "x", store_path: storePath, confirm: true });
    await secretsDelete({ name: "TEMP", store_path: storePath, confirm: true });
    await expect(secretsGet({ name: "TEMP", store_path: storePath })).rejects.toThrow(/not found/i);
  });

  it("throws when deleting a nonexistent secret", async () => {
    await expect(secretsDelete({ name: "GHOST", store_path: storePath, confirm: true })).rejects.toThrow(/not found/i);
  });

  it("rotates the master key and preserves decrypted values", async () => {
    await secretsSet({ name: "ROTATE_ME", value: "keepme", store_path: storePath, confirm: true });
    const newKey = crypto.randomBytes(32).toString("hex");
    process.env.SECRETS_MASTER_KEY_NEW = newKey;

    const result = await secretsRotateKey({ store_path: storePath, confirm: true });
    expect(result.rotated_count).toBe(1);

    // Old key should no longer decrypt correctly
    await expect(secretsGet({ name: "ROTATE_ME", store_path: storePath })).rejects.toThrow();

    // Switch to new key and verify decryption works
    process.env.SECRETS_MASTER_KEY = newKey;
    const result2 = await secretsGet({ name: "ROTATE_ME", store_path: storePath });
    expect(result2.value).toBe("keepme");
  });

  it("rejects rotation without SECRETS_MASTER_KEY_NEW set", async () => {
    await secretsSet({ name: "X", value: "y", store_path: storePath, confirm: true });
    await expect(secretsRotateKey({ store_path: storePath, confirm: true })).rejects.toThrow(/SECRETS_MASTER_KEY_NEW/);
  });

  it("throws if SECRETS_MASTER_KEY is missing", async () => {
    const saved = process.env.SECRETS_MASTER_KEY;
    delete process.env.SECRETS_MASTER_KEY;
    await expect(secretsGet({ name: "ANY", store_path: storePath })).rejects.toThrow(/SECRETS_MASTER_KEY not set/);
    process.env.SECRETS_MASTER_KEY = saved;
  });
});
