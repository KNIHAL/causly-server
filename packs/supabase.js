import { z } from "zod";
import * as supabaseOps from "../tools/supabaseOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
// ---------------- Supabase tools ----------------

server.registerTool(
  "supabase_list_organizations",
  {
    description: "List organizations the authenticated account belongs to. Needed to create a new project.",
    inputSchema: {},
  },
  wrap("supabase_list_organizations", supabaseOps.supabaseListOrganizations)
);

server.registerTool(
  "supabase_list_projects",
  {
    description: "List Supabase projects for the authenticated account.",
    inputSchema: {},
  },
  wrap("supabase_list_projects", supabaseOps.supabaseListProjects)
);

server.registerTool(
  "supabase_get_project",
  {
    description: "Get details of a single Supabase project by its ref/ID.",
    inputSchema: { project_ref: z.string() },
  },
  wrap("supabase_get_project", supabaseOps.supabaseGetProject)
);

server.registerTool(
  "supabase_create_project",
  {
    description:
      "Create a new Supabase project. Requires an organization_id (use supabase_list_organizations to find it) and a database password.",
    inputSchema: {
      name: z.string(),
      organization_id: z.string(),
      db_pass: z.string(),
      region: z.string().optional().describe("Defaults to ap-south-1"),
      plan: z.string().optional().describe("Defaults to free"),
    },
  },
  wrap("supabase_create_project", supabaseOps.supabaseCreateProject)
);

server.registerTool(
  "supabase_delete_project",
  {
    description: "Delete a Supabase project. DESTRUCTIVE — requires confirm: true.",
    inputSchema: { project_ref: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("supabase_delete_project", supabaseOps.supabaseDeleteProject)
);

server.registerTool(
  "supabase_run_sql",
  {
    description:
      "Run raw SQL against a project's database — used for creating tables, altering schema, seeding data, or running queries. HIGH risk — requires confirm: true.",
    inputSchema: {
      project_ref: z.string(),
      query: z.string().describe("Raw SQL statement(s) to execute"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("supabase_run_sql", supabaseOps.supabaseRunSql)
);
}
