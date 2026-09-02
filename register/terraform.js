
server.registerTool(
  "terraform_init",
  {
    description: "Initialize a Terraform working directory (downloads providers/modules).",
    inputSchema: {
      dir: z.string().describe("Path to the Terraform config directory"),
      upgrade: z.boolean().optional().describe("Upgrade providers/modules to latest allowed version"),
    },
  },
  wrap("terraform_init", terraformOps.terraformInit)
);

server.registerTool(
  "terraform_validate",
  {
    description: "Validate the configuration's syntax and internal consistency.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_validate", terraformOps.terraformValidate)
);

server.registerTool(
  "terraform_fmt",
  {
    description: "Format .tf files to canonical style.",
    inputSchema: {
      dir: z.string(),
      check: z.boolean().optional().describe("Only check formatting, don't rewrite files"),
    },
  },
  wrap("terraform_fmt", terraformOps.terraformFmt)
);

server.registerTool(
  "terraform_plan",
  {
    description: "Show an execution plan: what Terraform would change.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional().describe("Path to a .tfvars file"),
      out: z.string().optional().describe("Save the plan to this file for later apply"),
    },
  },
  wrap("terraform_plan", terraformOps.terraformPlan)
);

server.registerTool(
  "terraform_apply",
  {
    description: "Apply changes to reach the desired state. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional().describe("Path to a .tfvars file"),
      plan_file: z.string().optional().describe("Apply a previously saved plan file instead of a fresh plan"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_apply", terraformOps.terraformApply)
);

server.registerTool(
  "terraform_destroy",
  {
    description: "Destroy all resources managed by this configuration. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional().describe("Path to a .tfvars file"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_destroy", terraformOps.terraformDestroy)
);

server.registerTool(
  "terraform_show",
  {
    description: "Show the current state or a saved plan, human-readable or as JSON.",
    inputSchema: {
      dir: z.string(),
      target: z.string().optional().describe("A saved plan file to show instead of current state"),
      json: z.boolean().optional().describe("Output as JSON"),
    },
  },
  wrap("terraform_show", terraformOps.terraformShow)
);

server.registerTool(
  "terraform_output",
  {
    description: "Read output values from the root module's state.",
    inputSchema: {
      dir: z.string(),
      name: z.string().optional().describe("A single output name to read; omit for all outputs"),
      json: z.boolean().optional().describe("Defaults to true"),
    },
  },
  wrap("terraform_output", terraformOps.terraformOutput)
);

server.registerTool(
  "terraform_workspace",
  {
    description: "Manage Terraform workspaces (environments like dev/staging/prod). action: 'list' | 'new' | 'select' | 'delete' (defaults to list).",
    inputSchema: {
      dir: z.string(),
      action: z.string().optional().describe("list, new, select, or delete"),
      name: z.string().optional().describe("Workspace name, required for new/select/delete"),
    },
  },
  wrap("terraform_workspace", terraformOps.terraformWorkspace)
);

server.registerTool(
  "terraform_state_list",
  {
    description: "List all resources tracked in the current state.",
    inputSchema: { dir: z.string(), filter: z.string().optional().describe("Filter by resource address pattern") },
  },
  wrap("terraform_state_list", terraformOps.terraformStateList)
);

server.registerTool(
  "terraform_state_show",
  {
    description: "Show detailed attributes of a single resource in the state.",
    inputSchema: { dir: z.string(), address: z.string().describe("Resource address, e.g. azurerm_resource_group.main") },
  },
  wrap("terraform_state_show", terraformOps.terraformStateShow)
);

server.registerTool(
  "terraform_state_mv",
  {
    description: "Move a resource to a new address within the state (rename/refactor without destroy+recreate). HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      source: z.string(),
      destination: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_state_mv", terraformOps.terraformStateMv)
);

server.registerTool(
  "terraform_state_rm",
  {
    description: "Remove a resource from the state without destroying the real infrastructure (stops Terraform managing it). HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      address: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_state_rm", terraformOps.terraformStateRm)
);

server.registerTool(
  "terraform_state_pull",
  {
    description: "Download and print the raw remote state as JSON — useful for backend/state-drift inspection.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_state_pull", terraformOps.terraformStatePull)
);

server.registerTool(
  "terraform_import",
  {
    description: "Import an existing real-world resource into Terraform state, so it becomes managed by this config. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      address: z.string().describe("Terraform resource address to import into, e.g. azurerm_resource_group.main"),
      resource_id: z.string().describe("The real-world resource ID (e.g. Azure resource ID)"),
      var_file: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_import", terraformOps.terraformImport)
);

server.registerTool(
  "terraform_taint",
  {
    description: "Mark a resource as tainted, forcing it to be destroyed and recreated on the next apply. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      address: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_taint", terraformOps.terraformTaint)
);

server.registerTool(
  "terraform_untaint",
  {
    description: "Remove the tainted mark from a resource, so it will not be forcibly recreated.",
    inputSchema: { dir: z.string(), address: z.string() },
  },
  wrap("terraform_untaint", terraformOps.terraformUntaint)
);

server.registerTool(
  "terraform_graph",
  {
    description: "Generate a visual dependency graph of resources in DOT format.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_graph", terraformOps.terraformGraph)
);

server.registerTool(
  "terraform_providers",
  {
    description: "List the providers required by the configuration and their resolved versions.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_providers", terraformOps.terraformProviders)
);

server.registerTool(
  "terraform_plan_comment",
  {
    description:
      "CI/CD hook: run `terraform plan`, format a concise Markdown summary, and post it as a comment on a GitHub pull request — so reviewers see the infra diff before approving. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional(),
      owner: z.string().describe("GitHub repo owner"),
      repo: z.string().describe("GitHub repo name"),
      pull_number: z.number().describe("PR number to comment on"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_plan_comment", terraformOps.terraformPlanComment)
);
