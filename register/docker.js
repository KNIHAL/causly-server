

server.registerTool(
  "docker_version",
  {
    description: "Get Docker client/server version info — connectivity check.",
    inputSchema: {},
  },
  wrap("docker_version", dockerOps.dockerVersion)
);

server.registerTool(
  "docker_ps",
  {
    description: "List containers. Set all=true to include stopped ones (defaults to running only).",
    inputSchema: { all: z.boolean().optional().describe("Defaults to false (running only)") },
  },
  wrap("docker_ps", dockerOps.dockerPs)
);

server.registerTool(
  "docker_images",
  {
    description: "List images.",
    inputSchema: {},
  },
  wrap("docker_images", dockerOps.dockerImages)
);

server.registerTool(
  "docker_build",
  {
    description: "Build an image from a Dockerfile. HIGH risk — requires confirm: true.",
    inputSchema: {
      context_dir: z.string().describe("Build context directory"),
      tag: z.string().describe("Image tag, e.g. myapp:latest"),
      dockerfile: z.string().optional().describe("Path to Dockerfile, defaults to context_dir/Dockerfile"),
      build_args: z.record(z.string()).optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_build", dockerOps.dockerBuild)
);

server.registerTool(
  "docker_run",
  {
    description: "Run a new container from an image. HIGH risk — requires confirm: true.",
    inputSchema: {
      image: z.string(),
      name: z.string().optional(),
      ports: z.array(z.string()).optional().describe("e.g. ['8080:80']"),
      env: z.record(z.string()).optional(),
      volumes: z.array(z.string()).optional().describe("e.g. ['/host/path:/container/path']"),
      detach: z.boolean().optional().describe("Defaults to true"),
      command: z.string().optional().describe("Override command to run in the container"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_run", dockerOps.dockerRun)
);

server.registerTool(
  "docker_stop",
  {
    description: "Stop a running container. HIGH risk — requires confirm: true.",
    inputSchema: { container: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("docker_stop", dockerOps.dockerStop)
);

server.registerTool(
  "docker_start",
  {
    description: "Start a stopped container.",
    inputSchema: { container: z.string() },
  },
  wrap("docker_start", dockerOps.dockerStart)
);

server.registerTool(
  "docker_restart",
  {
    description: "Restart a container. HIGH risk — requires confirm: true.",
    inputSchema: { container: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("docker_restart", dockerOps.dockerRestart)
);

server.registerTool(
  "docker_remove",
  {
    description: "Remove a container. DESTRUCTIVE — requires confirm: true.",
    inputSchema: {
      container: z.string(),
      force: z.boolean().optional().describe("Force-remove even if running"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_remove", dockerOps.dockerRemove)
);

server.registerTool(
  "docker_remove_image",
  {
    description: "Remove an image. DESTRUCTIVE — requires confirm: true.",
    inputSchema: {
      image: z.string(),
      force: z.boolean().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_remove_image", dockerOps.dockerRemoveImage)
);

server.registerTool(
  "docker_logs",
  {
    description: "Get logs from a container.",
    inputSchema: {
      container: z.string(),
      tail: z.number().optional().describe("Number of lines from the end, defaults to 100"),
      since: z.string().optional().describe("e.g. '10m', '2026-09-01T00:00:00'"),
    },
  },
  wrap("docker_logs", dockerOps.dockerLogs)
);

server.registerTool(
  "docker_inspect",
  {
    description: "Inspect a container or image — full JSON metadata.",
    inputSchema: { target: z.string().describe("Container or image name/ID") },
  },
  wrap("docker_inspect", dockerOps.dockerInspect)
);

server.registerTool(
  "docker_exec",
  {
    description: "Execute a command inside a running container.",
    inputSchema: { container: z.string(), command: z.string().describe("e.g. 'ls -la'") },
  },
  wrap("docker_exec", dockerOps.dockerExec)
);

server.registerTool(
  "docker_stats",
  {
    description: "Show live resource usage stats (CPU, memory) for running containers — one-shot snapshot, not streaming.",
    inputSchema: {},
  },
  wrap("docker_stats", dockerOps.dockerStats)
);

server.registerTool(
  "docker_push",
  {
    description: "Push an image to a registry. HIGH risk — requires confirm: true.",
    inputSchema: { image: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("docker_push", dockerOps.dockerPush)
);

server.registerTool(
  "docker_pull",
  {
    description: "Pull an image from a registry.",
    inputSchema: { image: z.string() },
  },
  wrap("docker_pull", dockerOps.dockerPull)
);

server.registerTool(
  "docker_compose_up",
  {
    description: "Run docker compose up for a project directory. HIGH risk — requires confirm: true.",
    inputSchema: {
      project_dir: z.string().describe("Directory containing docker-compose.yml"),
      detach: z.boolean().optional().describe("Defaults to true"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_compose_up", dockerOps.dockerComposeUp)
);

server.registerTool(
  "docker_compose_down",
  {
    description: "Run docker compose down for a project directory. HIGH risk — requires confirm: true.",
    inputSchema: {
      project_dir: z.string().describe("Directory containing docker-compose.yml"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_compose_down", dockerOps.dockerComposeDown)
);
