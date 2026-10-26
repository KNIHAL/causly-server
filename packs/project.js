import { z } from "zod";
import * as projectOps from "../tools/projectOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
// ---------------- Project intelligence tools ----------------

server.registerTool(
  "project_detect",
  {
    description: "Detect a project's language, framework, and package manager by inspecting its manifest files.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("project_detect", projectOps.projectDetect)
);

server.registerTool(
  "project_info",
  {
    description: "Get structured project info: language, framework, package manager, resolved test/lint/typecheck/build commands, and current git branch/remotes.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("project_info", projectOps.projectInfo)
);

server.registerTool(
  "project_health",
  {
    description: "Get a health snapshot of a project: git cleanliness/ahead-behind, whether dependencies are installed, and which env files are present.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("project_health", projectOps.projectHealth)
);

server.registerTool(
  "run_tests",
  {
    description: "Detect and run the project's test command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_tests", projectOps.runTests)
);

server.registerTool(
  "run_lint",
  {
    description: "Detect and run the project's lint command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_lint", projectOps.runLint)
);

server.registerTool(
  "run_typecheck",
  {
    description: "Detect and run the project's typecheck command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_typecheck", projectOps.runTypecheck)
);

server.registerTool(
  "run_build",
  {
    description: "Detect and run the project's build command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_build", projectOps.runBuild)
);
}
