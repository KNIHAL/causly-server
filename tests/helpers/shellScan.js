// Finds places where a shell command is built as text. Used by tests/noShellStrings.test.js (P0-04).
// Safe pattern: execFile(file, [argv...]). Unsafe: exec(`...${x}...`) or execFile("bash", ["-lc", cmdText]).
const RULES = [
  { name: "template literal passed to exec", re: /(?<![.\w])(?:exec|execAsync|execSync)\s*\(\s*`/g },
  { name: "string concatenation passed to exec", re: /(?<![.\w])(?:exec|execAsync|execSync)\s*\(\s*(?:"[^"\n]*"|'[^'\n]*')\s*\+/g },
  {
    name: "shell flag followed by a built string",
    re: /["'](?:-lc|-c|-Command|-command|\/c)["']\s*,\s*(?:`|(?:"[^"\n]*"|'[^'\n]*')\s*\+)/g,
  },
  {
    // A variable after a shell flag is shell text of unknown origin. Only the run_command tool may do this.
    name: "shell flag followed by a variable",
    re: /["'](?:-lc|-c|-Command|-command|\/c)["']\s*,\s*[A-Za-z_$][\w$.]*\s*[\])]/g,
    allowable: true,
  },
];

export function findShellStringBuilding(source, { allowShellVariable = false } = {}) {
  const findings = [];
  for (const { name, re, allowable } of RULES) {
    if (allowable && allowShellVariable) continue;
    for (const match of source.matchAll(re)) {
      const line = source.slice(0, match.index).split("\n").length;
      findings.push({ rule: name, line, text: match[0].trim() });
    }
  }
  return findings;
}
