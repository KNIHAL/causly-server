import { z } from "zod";
import { wrap } from "../tools/toolWrapper.js";
import * as dbOps from "../tools/dbOps.js";

export default function register(server) {
//---------------- Database tools ----------------
server.registerTool(
  "postgres_query",
  {
    description: "Run a read or write SQL query against a Postgres database. HIGH risk - requires confirm: true.",
    inputSchema: {
      connection_string: z.string().describe("postgres://user:pass@host:5432/dbname"),
      sql: z.string(),
      params: z.array(z.any()).optional().describe("Positional params for $1, $2, ..."),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("postgres_query", dbOps.postgresQuery)
);

server.registerTool(
  "postgres_list_tables",
  {
    description: "List all tables in a Postgres database (public schema by default).",
    inputSchema: {
      connection_string: z.string(),
      schema: z.string().optional().describe("Defaults to 'public'"),
    },
  },
  wrap("postgres_list_tables", dbOps.postgresListTables)
);

server.registerTool(
  "postgres_describe_table",
  {
    description: "Get column names, types, and nullability for a Postgres table.",
    inputSchema: {
      connection_string: z.string(),
      table: z.string(),
      schema: z.string().optional().describe("Defaults to 'public'"),
    },
  },
  wrap("postgres_describe_table", dbOps.postgresDescribeTable)
);

server.registerTool(
  "postgres_test_connection",
  {
    description: "Test a Postgres connection string — returns server version on success.",
    inputSchema: { connection_string: z.string() },
  },
  wrap("postgres_test_connection", dbOps.postgresTestConnection)
);

server.registerTool(
  "mysql_query",
  {
    description: "Run a read or write SQL query against a MySQL database. HIGH risk - requires confirm: true.",
    inputSchema: {
      connection_string: z.string().describe("mysql://user:pass@host:3306/dbname"),
      sql: z.string(),
      params: z.array(z.any()).optional().describe("Positional params for ? placeholders"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("mysql_query", dbOps.mysqlQuery)
);

server.registerTool(
  "mysql_list_tables",
  {
    description: "List all tables in a MySQL database.",
    inputSchema: { connection_string: z.string() },
  },
  wrap("mysql_list_tables", dbOps.mysqlListTables)
);

server.registerTool(
  "mysql_describe_table",
  {
    description: "Get column names, types, and nullability for a MySQL table.",
    inputSchema: { connection_string: z.string(), table: z.string() },
  },
  wrap("mysql_describe_table", dbOps.mysqlDescribeTable)
);

server.registerTool(
  "mysql_test_connection",
  {
    description: "Test a MySQL connection string — returns server version on success.",
    inputSchema: { connection_string: z.string() },
  },
  wrap("mysql_test_connection", dbOps.mysqlTestConnection)
);
}
