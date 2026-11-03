import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { redactSecrets, redactSecretsInString } from "../tools/security.js";

// P0-03: credentials inside URLs, tokens and connection strings must never reach logs or error text.
const LEAKS = [
  ["postgres URL", "connect failed: postgres://admin:S3cretPw@db.example.com:5432/app", "S3cretPw"],
  ["mysql URL", "mysql://root:Tr0ub4dor@localhost:3306/shop timed out", "Tr0ub4dor"],
  ["password with @", "postgres://user:p@ss@host/db", "p@ss"],
  ["empty user", "redis://:RedisPw99@cache:6379", "RedisPw99"],
  ["token as user", "clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r.git", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["bearer", "request failed, Authorization header was Bearer abcDEF123456xyz", "abcDEF123456xyz"],
  ["github token", "bad credentials ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["github fine-grained", "github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz", "github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz"],
  ["slack token", "slack said xoxb-1234567890-abcdefghijkl", "xoxb-1234567890-abcdefghijkl"],
  ["sk key", "invalid key sk-abcdefghijklmnopqrstuvwx", "sk-abcdefghijklmnopqrstuvwx"],
  ["aws key", "denied for AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"],
  ["jwt", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r", "eyJhbGciOiJIUzI1NiJ9"],
  ["json password", '{"user":"a","password": "hunter2"}', "hunter2"],
  ["json db password", '{"db_password":"hunter2"}', "hunter2"],
  ["json connection string", '{"connection_string": "postgres://u:pw1234@h/db"}', "pw1234"],
  ["connection_string pair", "connection_string=postgres://u:pw5678@h/db", "pw5678"],
];

const UNCHANGED = [
  "https://example.com/path?x=1",
  "https://example.com/a@b",
  "postgres://localhost:5432/app",
  "contact me at user@example.com",
  "plain error: file not found",
  "see the task-list and desk-lamp docs",
];

describe("redactSecretsInString", () => {
  for (const [name, input, secret] of LEAKS) {
    test(`removes ${name}`, () => {
      const out = redactSecretsInString(input);
      assert.ok(!out.includes(secret), `leaked: ${out}`);
      assert.ok(out.includes("[REDACTED]"));
    });
  }

  for (const input of UNCHANGED) {
    test(`leaves alone: ${input}`, () => {
      assert.equal(redactSecretsInString(input), input);
    });
  }

  test("keeps the non-secret parts of a URL", () => {
    const out = redactSecretsInString("postgres://admin:S3cretPw@db.example.com:5432/app");
    assert.ok(out.includes("db.example.com:5432/app"));
  });
});

describe("redactSecrets (structured)", () => {
  test("connection-style keys are redacted by name", () => {
    const out = redactSecrets({
      connection_string: "x",
      connectionString: "x",
      dsn: "x",
      database_url: "x",
      note: "fine",
    });
    assert.deepEqual(out, {
      connection_string: "[REDACTED]",
      connectionString: "[REDACTED]",
      dsn: "[REDACTED]",
      database_url: "[REDACTED]",
      note: "fine",
    });
  });

  test("credentials inside any string value are removed, even under a harmless key", () => {
    const out = redactSecrets({ url: "https://u:pw9999@host/x", args: ["--db", "postgres://u:pw8888@h/d"], note: "fine" });
    const text = JSON.stringify(out);
    assert.ok(!text.includes("pw9999") && !text.includes("pw8888"), text);
    assert.equal(out.note, "fine");
  });

  test("a plain string is unchanged", () => {
    assert.equal(redactSecrets("plain string"), "plain string");
  });
});
