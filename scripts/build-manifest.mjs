// Builds packs/manifest.json: every pack's tool names and descriptions, so
// search_tools can find tools without importing (loading) their packs.
// Run: npm run build:manifest   (after adding or changing any tool)
import fs from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { PACKS } from "../packs/registry.js";

export async function collectManifest() {
  const packs = {};
  for (const [name, pack] of Object.entries(PACKS)) {
    const tools = [];
    const stub = {
      registerTool(toolName, config) {
        tools.push({ name: toolName, description: String(config?.description ?? "") });
      },
    };
    const mod = await pack.load();
    mod.default(stub);
    packs[name] = { description: pack.description, core: pack.core, tools };
  }
  return { packs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = await collectManifest();
  const out = fileURLToPath(new URL("../packs/manifest.json", import.meta.url));
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  const total = Object.values(manifest.packs).reduce((n, p) => n + p.tools.length, 0);
  console.log(`manifest.json written: ${Object.keys(manifest.packs).length} packs, ${total} tools`);
}
