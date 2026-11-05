// Resource limits (P1-06). Every limit has a default and a CAUSLY_* variable to change it.
// Values are read at call time so a changed environment applies without a restart.

const DEFAULTS = {
  CAUSLY_MAX_READ_BYTES: 2 * 1024 * 1024, // per file
  CAUSLY_MAX_BATCH_BYTES: 8 * 1024 * 1024, // per read_multiple_files call
  CAUSLY_MAX_LIST_ENTRIES: 2000, // list_directory, per folder
  CAUSLY_MAX_TREE_ENTRIES: 1000, // directory_tree, whole tree
  CAUSLY_MAX_SCAN_ENTRIES: 100000, // search_files, entries looked at
  CAUSLY_MAX_DB_POOLS: 8, // cached database pools per process
  CAUSLY_DB_POOL_IDLE_MS: 5 * 60_000, // close a pool unused this long
};

export function limit(name, env = process.env) {
  const fallback = DEFAULTS[name];
  if (fallback === undefined) throw new Error(`Unknown limit: ${name}`);
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const LIMIT_DEFAULTS = Object.freeze({ ...DEFAULTS });
