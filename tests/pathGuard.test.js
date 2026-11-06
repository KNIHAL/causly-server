import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as directoryOps from "../tools/directoryOps.js";
import * as fileOps from "../tools/fileOps.js";
import * as secretsOps from "../tools/secretsOps.js";

// P0-06: every file and directory tool must refuse protected paths, resolved on the real filesystem.
const isWin = process.platform === "win32";
const SYSTEM_DIR = isWin ? "C:\\Windows" : "/etc";
const EXTRA_CLEANUP = [];

let root;
let home;
let ssh;
let work;
let PROT; // a file inside a credentials folder
let NEW_PROT; // a new file in a credentials folder
let SAFE_FILE;
let SAFE_NEW;

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "causly-p006-")));
  home = path.join(root, "home");
  ssh = path.join(home, ".ssh");
  work = path.join(root, "work");
  fs.mkdirSync(ssh, { recursive: true });
  fs.mkdirSync(work);
  PROT = path.join(ssh, "id_test");
  NEW_PROT = path.join(ssh, "new.txt");
  SAFE_FILE = path.join(work, "safe.txt");
  SAFE_NEW = path.join(work, "safe-new.txt");
  fs.writeFileSync(PROT, "PRIVATE-KEY");
  fs.writeFileSync(SAFE_FILE, "hello");
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("SECRETS_MASTER_KEY", crypto.randomBytes(32).toString("hex"));
  vi.stubEnv("SECRETS_MASTER_KEY_NEW", crypto.randomBytes(32).toString("hex"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const p of EXTRA_CLEANUP.splice(0)) fs.rmSync(p, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

const reject = (fn) => expect(Promise.resolve().then(fn)).rejects.toThrow(/protected/i);

// One entry per exported function. A new export without an entry fails the "covers every export" tests below.
const FILE_OPS_CASES = () => ({
  readFile: [() => fileOps.readFile({ path: PROT })],
  readMultipleFiles: [
    async () => {
      const { results } = await fileOps.readMultipleFiles({ paths: [PROT] });
      if (results[0].success) return results; // would be a leak
      throw new Error(results[0].error);
    },
  ],
  createFile: [() => fileOps.createFile({ path: NEW_PROT, content: "x" })],
  writeFile: [() => fileOps.writeFile({ path: NEW_PROT, content: "x" })],
  editFile: [() => fileOps.editFile({ path: PROT, old_str: "PRIVATE", new_str: "PUBLIC" })],
  deleteFile: [() => fileOps.deleteFile({ path: PROT })],
  moveFile: [
    () => fileOps.moveFile({ source: PROT, destination: SAFE_NEW }),
    () => fileOps.moveFile({ source: SAFE_FILE, destination: NEW_PROT }),
  ],
  copyFile: [
    () => fileOps.copyFile({ source: PROT, destination: SAFE_NEW }),
    () => fileOps.copyFile({ source: SAFE_FILE, destination: NEW_PROT }),
  ],
  getFileInfo: [() => fileOps.getFileInfo({ path: PROT })],
});

const DIRECTORY_OPS_CASES = () => ({
  listDirectory: [() => directoryOps.listDirectory({ path: ssh })],
  directoryTree: [() => directoryOps.directoryTree({ path: ssh })],
  createDirectory: [() => directoryOps.createDirectory({ path: path.join(ssh, "sub") })],
  deleteDirectory: [() => directoryOps.deleteDirectory({ path: ssh })],
  searchFiles: [() => directoryOps.searchFiles({ root_path: ssh, pattern: "id" })],
});

function expectUntouched() {
  expect(fs.readFileSync(PROT, "utf8")).toBe("PRIVATE-KEY");
  expect(fs.readdirSync(ssh)).toEqual(["id_test"]);
  expect(fs.readdirSync(work).sort()).toEqual(["safe.txt"]);
  expect(fs.readFileSync(SAFE_FILE, "utf8")).toBe("hello");
}

describe("every exported file and directory tool calls the guard", () => {
  it("has a case for every export of fileOps.js", () => {
    expect(Object.keys(FILE_OPS_CASES()).sort()).toEqual(Object.keys(fileOps).sort());
  });

  it("has a case for every export of directoryOps.js", () => {
    expect(Object.keys(DIRECTORY_OPS_CASES()).sort()).toEqual(Object.keys(directoryOps).sort());
  });

  for (const [group, build] of [
    ["fileOps", FILE_OPS_CASES],
    ["directoryOps", DIRECTORY_OPS_CASES],
  ]) {
    for (const name of Object.keys(build())) {
      it(`${group}.${name} refuses a credentials folder`, async () => {
        for (let i = 0; i < build()[name].length; i++) {
          await reject(build()[name][i]);
        }
        expectUntouched();
      });
    }
  }
});

describe("system directories", () => {
  const target = (name) => {
    const p = path.join(SYSTEM_DIR, name);
    EXTRA_CLEANUP.push(p);
    return p;
  };

  it("refuses writes, copies in, moves in and new folders", async () => {
    const system = /protected system directory/;
    await expect(fileOps.writeFile({ path: target("causly-p0-06.txt"), content: "x" })).rejects.toThrow(system);
    await expect(fileOps.createFile({ path: target("causly-p0-06-b.txt"), content: "x" })).rejects.toThrow(system);
    await expect(fileOps.copyFile({ source: SAFE_FILE, destination: target("causly-p0-06-c.txt") })).rejects.toThrow(system);
    await expect(fileOps.moveFile({ source: SAFE_FILE, destination: target("causly-p0-06-d.txt") })).rejects.toThrow(system);
    await expect(directoryOps.createDirectory({ path: target("causly-p0-06-dir") })).rejects.toThrow(system);
    expect(fs.readFileSync(SAFE_FILE, "utf8")).toBe("hello");
  });

  it("still allows reading and listing them", async () => {
    const listing = await directoryOps.listDirectory({ path: SYSTEM_DIR });
    expect(listing.entries.length).toBeGreaterThan(0);
  });
});

describe("resolving the real path", () => {
  const linkType = isWin ? "junction" : "dir";

  it("refuses a write through a link that points into a system directory", async () => {
    const link = path.join(work, "sneaky");
    fs.symlinkSync(SYSTEM_DIR, link, linkType);
    const leaf = "causly-p0-06-link.txt";
    EXTRA_CLEANUP.push(path.join(SYSTEM_DIR, leaf));
    await expect(fileOps.writeFile({ path: path.join(link, leaf), content: "x" })).rejects.toThrow(/protected/);
    await expect(fileOps.copyFile({ source: SAFE_FILE, destination: path.join(link, leaf) })).rejects.toThrow(/protected/);
    expect(fs.existsSync(path.join(SYSTEM_DIR, leaf))).toBe(false);
  });

  it("refuses a read through a link that points into a credentials folder", async () => {
    const link = path.join(work, "to-ssh");
    fs.symlinkSync(ssh, link, linkType);
    await expect(fileOps.readFile({ path: path.join(link, "id_test") })).rejects.toThrow(/protected/);
    await expect(directoryOps.listDirectory({ path: link })).rejects.toThrow(/protected/);
  });

  it("refuses a link that points at a single protected file", async () => {
    if (isWin) return; // file symlinks need extra privileges on Windows
    const link = path.join(work, "key-link");
    fs.symlinkSync(PROT, link, "file");
    await expect(fileOps.readFile({ path: link })).rejects.toThrow(/protected/);
  });

  it("refuses .. traversal that ends in a protected folder", async () => {
    const sneaky = `${work}${path.sep}..${path.sep}home${path.sep}.ssh${path.sep}id_test`;
    await expect(fileOps.readFile({ path: sneaky })).rejects.toThrow(/protected/);
  });

  it("refuses a relative path that resolves into a protected folder", async () => {
    const cwd = process.cwd();
    process.chdir(work);
    try {
      await expect(fileOps.readFile({ path: path.join("..", "home", ".ssh", "id_test") })).rejects.toThrow(/protected/);
    } finally {
      process.chdir(cwd);
    }
  });

  it("still works for ordinary paths, including new files in new folders", async () => {
    expect((await fileOps.readFile({ path: SAFE_FILE })).content).toBe("hello");
    await fileOps.writeFile({ path: SAFE_NEW, content: "ok" });
    expect(fs.readFileSync(SAFE_NEW, "utf8")).toBe("ok");
    await fileOps.copyFile({ source: SAFE_FILE, destination: path.join(work, "deep", "copy.txt") });
    expect(fs.readFileSync(path.join(work, "deep", "copy.txt"), "utf8")).toBe("hello");
    const found = await directoryOps.searchFiles({ root_path: work, pattern: "safe" });
    expect(found.matches.length).toBeGreaterThan(0);
  });

  it("a sibling folder that only shares a name prefix is not protected", async () => {
    const sibling = path.join(home, ".ssh-notes");
    fs.mkdirSync(sibling);
    await fileOps.writeFile({ path: path.join(sibling, "a.txt"), content: "fine" });
    expect((await fileOps.readFile({ path: path.join(sibling, "a.txt") })).content).toBe("fine");
  });
});

describe("causly's own folder (API keys, secrets store, database)", () => {
  it("CAUSLY_HOME cannot be read or written through the file tools", async () => {
    const causlyHome = path.join(root, "causly-home");
    fs.mkdirSync(causlyHome);
    fs.writeFileSync(path.join(causlyHome, ".env"), "GROQ_API_KEY=secret");
    vi.stubEnv("CAUSLY_HOME", causlyHome);
    await expect(fileOps.readFile({ path: path.join(causlyHome, ".env") })).rejects.toThrow(/protected/);
    await expect(fileOps.writeFile({ path: path.join(causlyHome, ".env"), content: "x" })).rejects.toThrow(/protected/);
    await expect(directoryOps.listDirectory({ path: causlyHome })).rejects.toThrow(/protected/);
    const found = await directoryOps.searchFiles({ root_path: root, pattern: ".env" });
    expect(found.matches.map((m) => m.path)).not.toContain(path.join(causlyHome, ".env"));
    expect(fs.readFileSync(path.join(causlyHome, ".env"), "utf8")).toBe("GROQ_API_KEY=secret");
  });

  it("the secrets tools can still use their default store (it is not a file-tool argument)", async () => {
    vi.stubEnv("CAUSLY_WORKSPACE", work); // a custom store_path must be inside the data folder or the workspace (P1-11)
    const store = path.join(work, "secrets.enc");
    await secretsOps.secretsSet({ name: "K", value: "v", store_path: store, confirm: true });
    expect((await secretsOps.secretsGet({ name: "K", store_path: store })).value).toBe("v");
  });
});

describe("walkers skip protected folders instead of listing them", () => {
  it("searchFiles from a parent folder does not descend into .ssh", async () => {
    const found = await directoryOps.searchFiles({ root_path: home, pattern: "id_test" });
    expect(found.matches).toEqual([]);
  });

  it("directoryTree from a parent folder does not include .ssh contents", async () => {
    const tree = await directoryOps.directoryTree({ path: home });
    expect(JSON.stringify(tree)).not.toContain("id_test");
  });
});

describe("secrets store_path is guarded like any other path", () => {
  it("refuses a store inside a credentials folder or a system directory", async () => {
    const inSsh = path.join(ssh, "store.enc");
    const inSystem = path.join(SYSTEM_DIR, "causly-p0-06.enc");
    EXTRA_CLEANUP.push(inSystem);
    await expect(secretsOps.secretsSet({ name: "A", value: "b", store_path: inSsh, confirm: true })).rejects.toThrow(/protected/);
    await expect(secretsOps.secretsSet({ name: "A", value: "b", store_path: inSystem, confirm: true })).rejects.toThrow(/protected/);
    await expect(secretsOps.secretsGet({ name: "A", store_path: PROT })).rejects.toThrow(/protected/);
    await expect(secretsOps.secretsList({ store_path: PROT })).rejects.toThrow(/protected/);
    await expect(secretsOps.secretsDelete({ name: "A", store_path: PROT, confirm: true })).rejects.toThrow(/protected/);
    await expect(secretsOps.secretsRotateKey({ store_path: PROT, confirm: true })).rejects.toThrow(/protected/);
    expect(fs.existsSync(inSsh)).toBe(false);
    expect(fs.existsSync(inSystem)).toBe(false);
  });

  it("still works with an ordinary custom store_path", async () => {
    vi.stubEnv("CAUSLY_WORKSPACE", work); // a custom store_path must be inside the data folder or the workspace (P1-11)
    const store = path.join(work, "secrets.enc");
    await secretsOps.secretsSet({ name: "A", value: "b", store_path: store, confirm: true });
    expect((await secretsOps.secretsGet({ name: "A", store_path: store })).value).toBe("b");
  });
});

describe.skipIf(!isWin)("Windows path forms on the real filesystem", () => {
  it("refuses the admin share of this machine", async () => {
    const unc = "\\\\localhost\\C$\\Windows\\causly-p0-06-unc.txt";
    EXTRA_CLEANUP.push("C:\\Windows\\causly-p0-06-unc.txt");
    await expect(fileOps.writeFile({ path: unc, content: "x" })).rejects.toThrow(/protected/);
  });

  it("refuses reserved device names and alternate data streams", async () => {
    await expect(fileOps.readFile({ path: path.join(work, "CON") })).rejects.toThrow(/protected|reserved/i);
    await expect(fileOps.writeFile({ path: path.join(work, "NUL"), content: "x" })).rejects.toThrow(/reserved/i);
    await expect(fileOps.writeFile({ path: `${SAFE_FILE}::$DATA`, content: "x" })).rejects.toThrow(/alternate data stream/i);
    expect(fs.readFileSync(SAFE_FILE, "utf8")).toBe("hello");
  });

  it("refuses an 8.3 short name for Program Files", async () => {
    if (!fs.existsSync("C:\\PROGRA~1")) return; // short names are switched off on this volume
    const leaf = "causly-p0-06-short.txt";
    EXTRA_CLEANUP.push(path.join("C:\\Program Files", leaf));
    await expect(fileOps.writeFile({ path: path.join("C:\\PROGRA~1", leaf), content: "x" })).rejects.toThrow(/protected/);
  });
});
