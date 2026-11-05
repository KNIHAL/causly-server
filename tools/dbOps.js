import pg from "pg";
import mysql from "mysql2/promise";
import { limit } from "./limits.js";

const { Pool: PgPool } = pg;

// Connection pools cached by connection_string so repeated calls reuse them. The cache holds at most
// CAUSLY_MAX_DB_POOLS pools (least recently used is closed first) and closes a pool that has not been
// used for CAUSLY_DB_POOL_IDLE_MS.
const pgPools = new Map(); // key -> { pool, last }
const mysqlPools = new Map();
let sweeper = null;

function closePool(entry) {
  Promise.resolve()
    .then(() => entry.pool.end())
    .catch(() => {});
}

function sweepIdle(now = Date.now()) {
  const idle = limit("CAUSLY_DB_POOL_IDLE_MS");
  for (const cache of [pgPools, mysqlPools]) {
    for (const [key, entry] of cache) {
      if (now - entry.last > idle) {
        cache.delete(key);
        closePool(entry);
      }
    }
  }
  if (pgPools.size + mysqlPools.size === 0 && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

function ensureSweeper() {
  if (sweeper) return;
  const every = Math.max(1000, Math.min(limit("CAUSLY_DB_POOL_IDLE_MS") / 2, 60_000));
  sweeper = setInterval(() => sweepIdle(), every);
  sweeper.unref?.();
}

function cachedPool(cache, key, create) {
  const hit = cache.get(key);
  if (hit) {
    hit.last = Date.now();
    // re-insert so Map order is least-recently-used first
    cache.delete(key);
    cache.set(key, hit);
    return hit.pool;
  }
  const max = limit("CAUSLY_MAX_DB_POOLS");
  while (pgPools.size + mysqlPools.size >= max) {
    const victim = oldestEntry();
    if (!victim) break;
    victim.cache.delete(victim.key);
    closePool(victim.entry);
  }
  const entry = { pool: create(), last: Date.now() };
  cache.set(key, entry);
  ensureSweeper();
  return entry.pool;
}

function oldestEntry() {
  let best = null;
  for (const cache of [pgPools, mysqlPools]) {
    for (const [key, entry] of cache) {
      if (!best || entry.last < best.entry.last) best = { cache, key, entry };
      break; // first entry of each Map is its least recently used
    }
  }
  return best;
}

function getPgPool(connection_string) {
  return cachedPool(pgPools, connection_string, () => new PgPool({ connectionString: connection_string, max: 5 }));
}

function getMysqlPool(connection_string) {
  return cachedPool(mysqlPools, connection_string, () => mysql.createPool(connection_string));
}

/** Close every cached pool (tests and exit cleanup). */
export async function closeAllPools() {
  const all = [...pgPools.values(), ...mysqlPools.values()];
  pgPools.clear();
  mysqlPools.clear();
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  await Promise.allSettled(all.map((e) => e.pool.end()));
}

/** Pool count and a manual idle sweep, for tests. */
export const _pools = { size: () => pgPools.size + mysqlPools.size, sweepIdle };
function requireConnString(connection_string) {
  if (!connection_string) {
    throw new Error(
      "connection_string is required, e.g. postgres://user:pass@host:5432/dbname or mysql://user:pass@host:3306/dbname"
    );
  }
}

// ---------- Postgres ----------

/** Run a read or write SQL query against a Postgres database. */
export async function postgresQuery({ connection_string, sql, params }) {
  requireConnString(connection_string);
  const pool = getPgPool(connection_string);
  const result = await pool.query(sql, params || []);
  return {
    rows: result.rows,
    row_count: result.rowCount,
    fields: result.fields?.map((f) => f.name),
  };
}

/** List all tables in a Postgres database (public schema by default). */
export async function postgresListTables({ connection_string, schema = "public" }) {
  requireConnString(connection_string);
  const pool = getPgPool(connection_string);
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schema]
  );
  return { tables: result.rows.map((r) => r.table_name) };
}

/** Get column names, types, and nullability for a Postgres table. */
export async function postgresDescribeTable({ connection_string, table, schema = "public" }) {
  requireConnString(connection_string);
  const pool = getPgPool(connection_string);
  const result = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  );
  return { columns: result.rows };
}

/** Test a Postgres connection string — returns server version on success. */
export async function postgresTestConnection({ connection_string }) {
  requireConnString(connection_string);
  const pool = getPgPool(connection_string);
  const result = await pool.query("SELECT version()");
  return { connected: true, version: result.rows[0].version };
}

// ---------- MySQL ----------

/** Run a read or write SQL query against a MySQL database. */
export async function mysqlQuery({ connection_string, sql, params }) {
  requireConnString(connection_string);
  const pool = getMysqlPool(connection_string);
  const [rows, fields] = await pool.query(sql, params || []);
  return {
    rows: Array.isArray(rows) ? rows : [],
    affected_rows: rows?.affectedRows,
    insert_id: rows?.insertId,
    fields: fields?.map((f) => f.name),
  };
}

/** List all tables in a MySQL database. */
export async function mysqlListTables({ connection_string }) {
  requireConnString(connection_string);
  const pool = getMysqlPool(connection_string);
  const [rows] = await pool.query("SHOW TABLES");
  const tables = rows.map((r) => Object.values(r)[0]);
  return { tables };
}

/** Get column names, types, and nullability for a MySQL table. */
export async function mysqlDescribeTable({ connection_string, table }) {
  requireConnString(connection_string);
  const pool = getMysqlPool(connection_string);
  const [rows] = await pool.query(`DESCRIBE \`${table}\``);
  return { columns: rows };
}

/** Test a MySQL connection string — returns server version on success. */
export async function mysqlTestConnection({ connection_string }) {
  requireConnString(connection_string);
  const pool = getMysqlPool(connection_string);
  const [rows] = await pool.query("SELECT VERSION() as version");
  return { connected: true, version: rows[0].version };
}
