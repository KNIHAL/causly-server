// Copies the Docusaurus production build (website/build) into the repo's
// /docs folder, which is what GitHub Pages is configured to serve.
//
// This is a separate copy step rather than building directly into ../docs
// because the repo root's package.json declares "type": "module" — Node
// then treats every .js file under that directory tree as an ES module,
// including Docusaurus's generated CommonJS SSG bundles, which breaks the
// build. Building into website/build first (which has no such declaration)
// avoids the conflict entirely.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, "..", "build");
const docsDir = path.join(__dirname, "..", "..", "docs");

if (!fs.existsSync(buildDir)) {
  console.error(`Build directory not found: ${buildDir}. Run "npm run build" first.`);
  process.exit(1);
}

fs.rmSync(docsDir, { recursive: true, force: true });
fs.cpSync(buildDir, docsDir, { recursive: true });

console.log(`Copied ${buildDir} -> ${docsDir}`);
