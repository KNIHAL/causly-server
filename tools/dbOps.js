import pg from "pg";
import mysql from "mysql2/promise";

const { Pool: PgPool } = pg;

// Connection pools cached by connection_string so repeated calls reuse them.
const pgPools = new Map();
const mysqlPools = new Map();

function getPgPool(connection_string) {
  if (!pgPools.has(connection_string)) {
    pgPools.set(connection_string, new PgPool({ connectionString: connection_string, max: 5 }));
  }
  return pgPools.get(connection_string);
}

function getMysqlPool(connection_string) {
  if (!mysqlPools.has(connection_string)) {
    mysqlPools.set(connection_string, mysql.createPool(connection_string));
  }
  return mysqlPools.get(connection_string);
}

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
