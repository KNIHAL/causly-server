// Path protection for the file, directory and secrets tools. Rules live in pathRules.js; this
// adds what needs the filesystem: relative paths are resolved, then symlinks, junctions and
// Windows 8.3 short names are followed to the REAL location before the rules are applied.
// Without that, a link or ".." trick could point a harmless-looking path at a protected folder.
import fs from "fs";
import path from "path";
import { isPathDenied } from "./pathRules.js";

const style = () => (process.platform === "win32" ? "win32" : "auto");

/**
 * Real path of the deepest part of `absolute` that exists, with the not-yet-existing rest
 * appended. A new file below a symlinked folder therefore resolves to the link's target.
 */
function realPathBestEffort(absolute) {
  const rest = [];
  let current = absolute;
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Check a path for the given access ("write" is the default, "read" for tools that only look).
 * Returns { denied, reason }.
 */
export function checkPathAccess(targetPath, access = "write") {
  if (typeof targetPath !== "string" || targetPath === "") return { denied: false };
  const options = { access, style: style() };

  const asGiven = isPathDenied(targetPath, options);
  if (asGiven.denied) return asGiven;

  const absolute = path.resolve(targetPath);
  const resolved = isPathDenied(absolute, options);
  if (resolved.denied) return { denied: true, reason: resolved.reason.replace(absolute, () => targetPath) };

  // Network paths are not resolved: that can be slow or hang when the share is unreachable.
  if (absolute.startsWith("\\\\")) return { denied: false };

  const real = realPathBestEffort(absolute);
  if (real !== absolute) {
    const viaLink = isPathDenied(real, options);
    if (viaLink.denied) {
      const verb = access === "write" ? "modified" : "accessed";
      return {
        denied: true,
        reason: `'${targetPath}' resolves to '${real}', which is a protected location, and cannot be ${verb} through this tool. ${viaLink.reason}`,
      };
    }
  }
  return { denied: false };
}

/** Throws when the path is protected for this access. */
export function assertPathAllowed(targetPath, access = "write") {
  const check = checkPathAccess(targetPath, access);
  if (check.denied) throw new Error(check.reason);
}

/** True when the path may be used for this access (used by walkers that skip protected folders). */
export function isPathAllowed(targetPath, access = "read") {
  return !checkPathAccess(targetPath, access).denied;
}
