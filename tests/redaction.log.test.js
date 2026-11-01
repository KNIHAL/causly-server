import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, beforeEach, test, vi } from "vitest";
import { createToolWrapper } from "../tools/toolWrapper.js";
import * as dbOps from "../tools/dbOps.js";

// P0-03: a Postgres call with a password in the connection string must not leak into the log or the returned error.
const PASSWORD = "Sup3rS3cretPw";
const CONN = `postgres://admin:${PASSWORD}@127.0.0.1:1/appdb`;

let written;

beforeEach(() => {
  written = [];
  vi.spyOn(fs, "appendFileSync").mockImplementation((_file, line) => {
    written.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeWrap() {
  return createToolWrapper({
    approvalCheck: () => ({ allowed: true }),
    workspaceCheck: () => ({ allowed: true }),
    receiptEmitter: () => {},
    envRefresher: () => {},
    errorHinter: () => null,
  });
}

test("real postgres_query call: password is absent from the log line", async () => {
  const tool = makeWrap()("postgres_query", dbOps.postgresQuery);
  const result = await tool({ connection_string: CONN, sql: "select 1" });
  assert.equal(result.isError, true);
  assert.ok(written.length > 0, "nothing was logged");
  assert.ok(!written.join("").includes(PASSWORD), written.join(""));
  assert.ok(!result.content[0].text.includes(PASSWORD));
});

test("an error that echoes the connection string is redacted in the log and in the response", async () => {
  const tool = makeWrap()("postgres_query", async ({ connection_string }) => {
    throw new Error(`could not connect using ${connection_string}`);
  });
  const result = await tool({ connection_string: CONN, sql: "select 1" });
  assert.equal(result.isError, true);
  assert.ok(!result.content[0].text.includes(PASSWORD), result.content[0].text);
  assert.ok(!written.join("").includes(PASSWORD), written.join(""));
});
