import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { PERMISSION_LEVELS } from "../tools/security.js";

// P0-07: the tool pages of the docs site must match packs/manifest.json (tool names) and
// tools/security.js (permission levels). The docs live in the agenv repo, so this test needs it:
//   - locally it looks for a sibling folder ../agenv (or the path in CAUSLY_DOCS_DIR),
//   - CI checks the repo out and sets CAUSLY_DOCS_DIR and CAUSLY_REQUIRE_DOCS=1.
// Run it by hand:  CAUSLY_DOCS_DIR=D:\agenv\website\docs\server npx vitest run tests/docsDrift.test.js
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsServerDir = process.env.CAUSLY_DOCS_DIR || path.resolve(root, "..", "agenv", "website", "docs", "server");
const toolsDir = path.join(docsServerDir, "tools");
const docsAvailable = fs.existsSync(toolsDir);
const required = /^(1|true|yes)$/i.test(process.env.CAUSLY_REQUIRE_DOCS || "");

// Packs that are intentionally not documented yet.
const UNDOCUMENTED_PACKS = ["stripe", "discord"];
const LEVELS = new Set(["READ", "LOW", "MEDIUM", "HIGH", "DESTRUCTIVE"]);
const NAME = "[a-z][a-z0-9_]*";

const manifest = JSON.parse(fs.readFileSync(path.join(root, "packs", "manifest.json"), "utf8")).packs;
const manifestTools = new Map(); // name -> pack
for (const [pack, def] of Object.entries(manifest)) for (const t of def.tools) manifestTools.set(t.name, pack);

/** Reads one docs page. Returns the names it mentions, the names it defines, and the level claims. */
export function parsePage(text) {
  const mentioned = new Set();
  const defined = [];
  const claims = []; // { name, kind: "level" | "confirm", value }
  for (const m of text.matchAll(new RegExp(`\`(${NAME})\``, "g"))) mentioned.add(m[1]);

  let inToolTable = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\|\s*Tool\s*\|/i.test(line)) {
      inToolTable = true;
      continue;
    }
    if (!line.startsWith("|")) inToolTable = false;
    if (inToolTable) {
      const row = line.match(new RegExp(`^\\|\\s*\`(${NAME})\`\\s*\\|\\s*([^|]*?)\\s*\\|`));
      if (row) {
        defined.push(row[1]);
        const cell = row[2].replace(/`/g, "").trim();
        if (LEVELS.has(cell)) claims.push({ name: row[1], kind: "level", value: cell });
        else if (/^(yes|no)$/i.test(cell)) claims.push({ name: row[1], kind: "confirm", value: cell.toLowerCase() });
      }
      continue;
    }
    const heading = line.match(/^#{2,4}\s+(.*)$/);
    if (heading) for (const m of heading[1].matchAll(new RegExp(`\`(${NAME})\``, "g"))) defined.push(m[1]);
    for (const m of line.matchAll(new RegExp(`\\*\\*\`(${NAME})\`\\*\\*\\s*\\((READ|LOW|MEDIUM|HIGH|DESTRUCTIVE)\\)`, "g"))) {
      defined.push(m[1]);
      claims.push({ name: m[1], kind: "level", value: m[2] });
    }
  }
  // "`run_command` runs ... It is a `HIGH` tool"
  for (const m of text.matchAll(new RegExp(`\`(${NAME})\`[^\`]{0,160}?\\.\\s+It is an? \`(READ|LOW|MEDIUM|HIGH|DESTRUCTIVE)\` tool`, "g"))) {
    claims.push({ name: m[1], kind: "level", value: m[2] });
  }
  return { mentioned, defined, claims };
}

/** Compares parsed pages with the manifest and the permission levels. Returns a list of problems. */
export function findDrift(pages, tools = manifestTools, levels = PERMISSION_LEVELS) {
  const problems = [];
  const mentioned = new Set();
  for (const [file, page] of Object.entries(pages)) {
    for (const name of page.mentioned) mentioned.add(name);
    for (const name of page.defined) {
      if (!tools.has(name)) problems.push(`${file}: documents a tool that does not exist: ${name}`);
    }
    for (const claim of page.claims) {
      const level = levels[claim.name];
      if (!level) continue;
      const needsConfirm = level === "HIGH" || level === "DESTRUCTIVE";
      if (claim.kind === "level" && claim.value !== level) {
        problems.push(`${file}: ${claim.name} is ${claim.value} in the docs but ${level} in tools/security.js`);
      }
      if (claim.kind === "confirm" && (claim.value === "yes") !== needsConfirm) {
        problems.push(`${file}: ${claim.name} says confirm=${claim.value} but its level is ${level}`);
      }
    }
  }
  for (const [name, pack] of tools) {
    if (UNDOCUMENTED_PACKS.includes(pack)) continue;
    if (!mentioned.has(name)) problems.push(`tool ${name} (${pack}) is not documented on any tools page`);
  }
  return problems;
}

describe("manifest and permission levels agree", () => {
  test("every tool in packs/manifest.json has a permission level", () => {
    const missing = [...manifestTools.keys()].filter((name) => !(name in PERMISSION_LEVELS));
    assert.deepEqual(missing, []);
  });

  test("every permission level is a known level", () => {
    for (const [name, level] of Object.entries(PERMISSION_LEVELS)) {
      assert.ok(LEVELS.has(level), `${name} has unknown level ${level}`);
    }
  });
});

describe("docs drift checker (broken fixtures must fail)", () => {
  const tools = new Map([["alpha_read", "p"], ["alpha_delete", "p"]]);
  const levels = { alpha_read: "READ", alpha_delete: "DESTRUCTIVE" };
  const page = (md) => ({ "x.md": parsePage(md) });

  test("a matching page passes", () => {
    const md = "| Tool | Risk | What |\n|---|---|---|\n| `alpha_read` | `READ` | r |\n| `alpha_delete` | DESTRUCTIVE | d |\n";
    assert.deepEqual(findDrift(page(md), tools, levels), []);
  });

  test("a wrong level fails", () => {
    const md = "| Tool | Risk | What |\n|---|---|---|\n| `alpha_read` | HIGH | r |\n| `alpha_delete` | DESTRUCTIVE | d |\n";
    assert.equal(findDrift(page(md), tools, levels).length, 1);
  });

  test("a wrong confirm column fails", () => {
    const md = "| Tool | Confirm | What |\n|---|---|---|\n| `alpha_read` | Yes | r |\n| `alpha_delete` | Yes | d |\n";
    assert.equal(findDrift(page(md), tools, levels).length, 1);
  });

  test("a tool that does not exist fails", () => {
    const md = "| Tool | Risk | What |\n|---|---|---|\n| `alpha_read` | READ | r |\n| `alpha_delete` | DESTRUCTIVE | d |\n| `alpha_gone` | READ | x |\n";
    assert.equal(findDrift(page(md), tools, levels).length, 1);
  });

  test("an undocumented tool fails", () => {
    const md = "| Tool | Risk | What |\n|---|---|---|\n| `alpha_read` | READ | r |\n";
    assert.equal(findDrift(page(md), tools, levels).length, 1);
  });

  test("heading, bold-level and prose forms are understood", () => {
    const md = "### `alpha_read` + `alpha_delete`\n\n**`alpha_read`** (HIGH) does a thing.\n";
    const problems = findDrift(page(md), tools, levels);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /alpha_read is HIGH in the docs but READ/);
  });
});

describe.skipIf(!docsAvailable && !required)("docs match the code", () => {
  test("the docs folder exists", () => {
    assert.ok(docsAvailable, `docs not found at ${toolsDir} (set CAUSLY_DOCS_DIR)`);
  });

  test("tool names and permission levels on every tools page match the code", () => {
    const pages = {};
    for (const file of fs.readdirSync(toolsDir).filter((f) => f.endsWith(".md"))) {
      pages[file] = parsePage(fs.readFileSync(path.join(toolsDir, file), "utf8"));
    }
    assert.deepEqual(findDrift(pages), []);
  });
});
