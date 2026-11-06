import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { secretsSet, secretsGet, secretsRotateKey, parseKey } from "../tools/secretsOps.js";
import { checkApproval } from "../tools/security.js";

const goodKey = () => crypto.randomBytes(32).toString("hex");
let dir;
let store;
let savedKey;

beforeEach(async () => {
  savedKey = process.env.SECRETS_MASTER_KEY;
  process.env.SECRETS_MASTER_KEY = goodKey();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "causly-polish-"));
  process.env.CAUSLY_WORKSPACE = dir;
  store = path.join(dir, "store.enc");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.CAUSLY_WORKSPACE;
  delete process.env.SECRETS_MASTER_KEY_NEW;
  if (savedKey === undefined) delete process.env.SECRETS_MASTER_KEY;
  else process.env.SECRETS_MASTER_KEY = savedKey;
});

describe("master key must be exactly 64 hex characters", () => {
  it("accepts 64 hex characters, upper or lower case", () => {
    expect(parseKey("a".repeat(64), "K")).toHaveLength(32);
    expect(parseKey("A1".repeat(32), "K")).toHaveLength(32);
  });

  it.each([
    ["too short", "ab".repeat(31)],
    ["too long", "ab".repeat(33)],
    ["odd length", "a".repeat(63)],
    ["not hex", "zz".repeat(32)],
    ["64 hex plus trailing junk (Buffer.from alone would accept it)", `${"ab".repeat(32)}zz`],
    ["a space inside", `${"ab".repeat(15)} b${"ab".repeat(16)}`],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(() => parseKey(value, "SECRETS_MASTER_KEY")).toThrow(/64-character hex/);
  });

  it("is enforced for SECRETS_MASTER_KEY on every operation", async () => {
    process.env.SECRETS_MASTER_KEY = `${"ab".repeat(32)}zz`;
    await expect(secretsSet({ name: "A", value: "1", store_path: store, confirm: true })).rejects.toThrow(/64-character hex/);
    await expect(fs.stat(store)).rejects.toThrow(); // nothing was written
  });

  it("is enforced for SECRETS_MASTER_KEY_NEW before anything is touched", async () => {
    await secretsSet({ name: "A", value: "1", store_path: store, confirm: true });
    const before = await fs.readFile(store);
    process.env.SECRETS_MASTER_KEY_NEW = `${"ab".repeat(32)}zz`;
    await expect(secretsRotateKey({ store_path: store, confirm: true })).rejects.toThrow(/SECRETS_MASTER_KEY_NEW must be/);
    expect(await fs.readFile(store)).toEqual(before);
  });
});

describe("secrets_get needs approval", () => {
  it("is blocked without confirm: true and allowed with it", () => {
    expect(checkApproval("secrets_get", { name: "A" }).allowed).toBe(false);
    expect(checkApproval("secrets_get", { name: "A", confirm: "true" }).allowed).toBe(false);
    expect(checkApproval("secrets_get", { name: "A", confirm: true }).allowed).toBe(true);
  });
});

describe("writes are atomic", () => {
  const leftovers = async () => (await fs.readdir(dir)).filter((f) => f !== "store.enc");

  it("secrets_set leaves only the store file", async () => {
    await secretsSet({ name: "A", value: "1", store_path: store, confirm: true });
    await secretsSet({ name: "B", value: "2", store_path: store, confirm: true });
    expect(await leftovers()).toEqual([]);
  });

  it("a rotation that fails part-way leaves the old store byte for byte, with no temp file", async () => {
    await secretsSet({ name: "A", value: "1", store_path: store, confirm: true });
    await secretsSet({ name: "B", value: "2", store_path: store, confirm: true });
    // Damage the second entry so decrypting it fails after the first was already re-encrypted in memory.
    const data = JSON.parse(await fs.readFile(store, "utf8"));
    data.B.tag = "00".repeat(16);
    await fs.writeFile(store, JSON.stringify(data, null, 2));
    const before = await fs.readFile(store);

    process.env.SECRETS_MASTER_KEY_NEW = goodKey();
    await expect(secretsRotateKey({ store_path: store, confirm: true })).rejects.toThrow();
    expect(await fs.readFile(store)).toEqual(before);
    expect(await leftovers()).toEqual([]);
  });

  it("a successful rotation replaces every entry and still leaves no temp file", async () => {
    await secretsSet({ name: "A", value: "1", store_path: store, confirm: true });
    const newKey = goodKey();
    process.env.SECRETS_MASTER_KEY_NEW = newKey;
    await secretsRotateKey({ store_path: store, confirm: true });
    process.env.SECRETS_MASTER_KEY = newKey;
    expect((await secretsGet({ name: "A", store_path: store })).value).toBe("1");
    expect(await leftovers()).toEqual([]);
  });
});

describe("store_path must be an allowed folder holding a real store", () => {
  it("rejects a path outside the data folder and the workspace", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "causly-outside-"));
    try {
      const target = path.join(outside, "store.enc");
      await expect(secretsSet({ name: "A", value: "1", store_path: target, confirm: true })).rejects.toThrow(/outside the folders/);
      await expect(secretsGet({ name: "A", store_path: target })).rejects.toThrow(/outside the folders/);
      await expect(fs.stat(target)).rejects.toThrow();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a ../ path that climbs out of the workspace", async () => {
    const sneaky = path.join(dir, "..", "escaped.enc");
    await expect(secretsSet({ name: "A", value: "1", store_path: sneaky, confirm: true })).rejects.toThrow(/outside the folders/);
  });

  it("refuses to use, or overwrite, an existing file that is not a secrets store", async () => {
    const pkg = path.join(dir, "package.json");
    const original = JSON.stringify({ name: "my-app", version: "1.0.0" });
    await fs.writeFile(pkg, original);
    await expect(secretsSet({ name: "A", value: "1", store_path: pkg, confirm: true })).rejects.toThrow(/not a Causly secrets store/);
    expect(await fs.readFile(pkg, "utf8")).toBe(original);

    const env = path.join(dir, ".env");
    await fs.writeFile(env, "GITHUB_TOKEN=abc\n");
    await expect(secretsSet({ name: "A", value: "1", store_path: env, confirm: true })).rejects.toThrow(/not a Causly secrets store/);
    expect(await fs.readFile(env, "utf8")).toBe("GITHUB_TOKEN=abc\n");
  });

  it("still works for a store inside the workspace", async () => {
    await secretsSet({ name: "A", value: "1", store_path: store, confirm: true });
    expect((await secretsGet({ name: "A", store_path: store })).value).toBe("1");
  });
});
