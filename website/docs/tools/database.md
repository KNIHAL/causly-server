---
sidebar_position: 6
---

# Database (Postgres / MySQL)

8 generic SQL tools — 4 for Postgres, 4 for MySQL — connection-string based, no ORM or schema
assumptions. Implemented in `tools/dbOps.js`.

## Setup

No separate service account needed — just a connection string:

```
postgres://user:pass@host:5432/dbname
mysql://user:pass@host:3306/dbname
```

Pass it directly as the `connection_string` argument on every call. Connections are pooled and
reused per unique connection string within the server process.

## Postgres

| Tool | Risk | What it does |
|---|---|---|
| `postgres_query` | MEDIUM | Run a read or write SQL query |
| `postgres_list_tables` | READ | List tables in a schema (defaults to `public`) |
| `postgres_describe_table` | READ | Column names, types, nullability |
| `postgres_test_connection` | READ | Verify a connection string, return server version |

## MySQL

| Tool | Risk | What it does |
|---|---|---|
| `mysql_query` | MEDIUM | Run a read or write SQL query |
| `mysql_list_tables` | READ | List all tables |
| `mysql_describe_table` | READ | Column names, types, nullability |
| `mysql_test_connection` | READ | Verify a connection string, return server version |

## Example

```
"Connect to my staging Postgres DB and show me the schema of the users table."
```

Claude calls `postgres_describe_table` with the connection string and `table: "users"`.
