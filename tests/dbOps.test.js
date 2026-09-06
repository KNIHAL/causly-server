import { describe, it, expect } from "vitest";
import {
  postgresQuery,
  postgresListTables,
  postgresDescribeTable,
  postgresTestConnection,
  mysqlQuery,
  mysqlListTables,
  mysqlDescribeTable,
  mysqlTestConnection,
} from "../tools/dbOps.js";

describe("dbOps — connection_string validation", () => {
  it("postgresQuery rejects missing connection_string", async () => {
    await expect(postgresQuery({ sql: "SELECT 1" })).rejects.toThrow(/connection_string is required/);
  });

  it("postgresListTables rejects missing connection_string", async () => {
    await expect(postgresListTables({})).rejects.toThrow(/connection_string is required/);
  });

  it("postgresDescribeTable rejects missing connection_string", async () => {
    await expect(postgresDescribeTable({ table: "users" })).rejects.toThrow(/connection_string is required/);
  });

  it("postgresTestConnection rejects missing connection_string", async () => {
    await expect(postgresTestConnection({})).rejects.toThrow(/connection_string is required/);
  });

  it("mysqlQuery rejects missing connection_string", async () => {
    await expect(mysqlQuery({ sql: "SELECT 1" })).rejects.toThrow(/connection_string is required/);
  });

  it("mysqlListTables rejects missing connection_string", async () => {
    await expect(mysqlListTables({})).rejects.toThrow(/connection_string is required/);
  });

  it("mysqlDescribeTable rejects missing connection_string", async () => {
    await expect(mysqlDescribeTable({ table: "users" })).rejects.toThrow(/connection_string is required/);
  });

  it("mysqlTestConnection rejects missing connection_string", async () => {
    await expect(mysqlTestConnection({})).rejects.toThrow(/connection_string is required/);
  });

  it("postgresTestConnection fails cleanly on unreachable host", async () => {
    await expect(
      postgresTestConnection({ connection_string: "postgres://user:pass@127.0.0.1:1/nope" })
    ).rejects.toThrow();
  });

  it("mysqlTestConnection fails cleanly on unreachable host", async () => {
    await expect(
      mysqlTestConnection({ connection_string: "mysql://user:pass@127.0.0.1:1/nope" })
    ).rejects.toThrow();
  });
});
