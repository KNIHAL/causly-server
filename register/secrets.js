// Paste this block into index.js, in the tools import section (near the top):
//   import * as secretsOps from "./tools/secretsOps.js";
//
// Then paste the block below as a new "Secrets manager tools" section.

server.registerTool(
  "secrets_set",
  {
    description: "Store an encrypted secret by name. HIGH risk — requires confirm: true.",
    inputSchema: {
      name: z.string(),
      value: z.string(),
      store_path: z.string().optional().describe("Defaults to .causly-secrets.enc in the server's working directory"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("secrets_set", secretsOps.secretsSet)
);

server.registerTool(
  "secrets_get",
  {
    description: "Retrieve and decrypt a secret by name.",
    inputSchema: {
      name: z.string(),
      store_path: z.string().optional(),
    },
  },
  wrap("secrets_get", secretsOps.secretsGet)
);

server.registerTool(
  "secrets_list",
  {
    description: "List secret names in the store (never returns values).",
    inputSchema: { store_path: z.string().optional() },
  },
  wrap("secrets_list", secretsOps.secretsList)
);

server.registerTool(
  "secrets_delete",
  {
    description: "Delete a secret by name. DESTRUCTIVE — requires confirm: true.",
    inputSchema: {
      name: z.string(),
      store_path: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("secrets_delete", secretsOps.secretsDelete)
);

server.registerTool(
  "secrets_rotate_key",
  {
    description:
      "Re-encrypt every secret in the store under a new master key. Call this AFTER setting SECRETS_MASTER_KEY_NEW in your environment. HIGH risk — requires confirm: true.",
    inputSchema: {
      store_path: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("secrets_rotate_key", secretsOps.secretsRotateKey)
);

server.registerTool(
  "secrets_generate_key",
  {
    description: "Generate a new random 32-byte master key (hex-encoded) — use to initialize SECRETS_MASTER_KEY or for rotation.",
    inputSchema: {},
  },
  wrap("secrets_generate_key", secretsOps.secretsGenerateKey)
);
