import { describe, it, expect } from "vitest";
import fs from "node:fs";

// P0-12: the package metadata that npm, the MCP Registry and Glama show must be complete and consistent.
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const pkg = read("package.json");
const server = read("server.json");

describe("release metadata", () => {
  it("package.json points to the website, the repository and the issue tracker", () => {
    expect(pkg.homepage).toBe("https://server.causly.in");
    expect(pkg.repository.url).toContain("github.com/KNIHAL/causly-server");
    expect(pkg.bugs.url).toBe("https://github.com/KNIHAL/causly-server/issues");
    expect(pkg.license).toBe("MIT");
  });

  it("server.json (MCP Registry) has the same version as package.json", () => {
    expect(server.version).toBe(pkg.version);
    for (const p of server.packages ?? []) {
      expect(p.version).toBe(pkg.version);
      expect(p.identifier).toBe(pkg.name);
    }
    expect(server.name).toBe(pkg.mcpName);
  });

  it("the changelog has a section for the current version", () => {
    const changelog = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    expect(changelog).toContain(`## [${pkg.version}]`);
  });

  it("a publish workflow with provenance exists", () => {
    const wf = fs.readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
    expect(wf).toContain("npm publish --provenance");
    expect(wf).toContain("id-token: write");
  });
});
