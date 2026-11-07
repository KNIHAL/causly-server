import { describe, it, expect } from "vitest";
import fs from "fs";
import { licenseAllowed, findViolations } from "../scripts/check-licenses.mjs";

describe("license check", () => {
  it("accepts allowlisted licenses and expressions", () => {
    for (const l of ["MIT", "ISC", "Apache-2.0", "(MIT OR GPL-3.0)", "(MIT AND BSD-3-Clause)"]) expect(licenseAllowed(l), l).toBe(true);
  });

  it("rejects copyleft, unknown and missing licenses", () => {
    for (const l of ["GPL-3.0", "AGPL-3.0-only", "SEE LICENSE IN LICENSE.txt", "", undefined, "(MIT AND GPL-3.0)"]) expect(licenseAllowed(l), String(l)).toBe(false);
  });

  it("ignores dev dependencies and flags production ones", () => {
    const lock = {
      packages: {
        "": { name: "root" },
        "node_modules/a": { version: "1.0.0", license: "MIT" },
        "node_modules/b": { version: "1.0.0", license: "GPL-3.0" },
        "node_modules/c": { version: "1.0.0", license: "GPL-3.0", dev: true },
        "node_modules/x/node_modules/d": { version: "2.0.0" },
      },
    };
    expect(findViolations(lock).map((p) => p.name)).toEqual(["b", "d"]);
  });

  it("every production dependency of this package is on the allowlist", () => {
    const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    expect(findViolations(lock)).toEqual([]);
  });
});
