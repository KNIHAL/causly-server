// MCP resources that give the agent project context without a string of tool calls. The repo path is
// passed URI-encoded as a single path segment (Windows paths contain ':' and '\', which are not safe as
// raw URI template variables) and decoded on read. Example URI:
//   causly://project/D%3A%5Ccausly-server/health
//
// A resource read goes through the same workspace limit as a tool call (P1-03): with CAUSLY_WORKSPACE on,
// a project outside it is refused and the refusal is written to the activity log.
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as gitOps from "./gitOps.js";
import * as projectOps from "./projectOps.js";
import { checkWorkspace } from "./workspace.js";
import { logActivity } from "./logger.js";

export const PROJECT_RESOURCES = [
  {
    kind: "health",
    name: "project_health_resource",
    title: "Project Health",
    description: "Git cleanliness, dependency install status, and env file presence for a project directory.",
    run: (input) => projectOps.projectHealth(input),
  },
  {
    kind: "info",
    name: "project_info_resource",
    title: "Project Info",
    description: "Language, framework, package manager, resolved commands, and git branch/remotes for a project directory.",
    run: (input) => projectOps.projectInfo(input),
  },
  {
    kind: "git",
    name: "project_git_resource",
    title: "Project Git State",
    description: "Current git status (changed files, ahead/behind, clean state) for a project directory.",
    run: (input) => gitOps.gitStatus(input),
  },
];

/** The repo path of a resource URI, or an error for a value that is not one plain encoded path. */
export function decodeProjectPath(encodedPath) {
  if (typeof encodedPath !== "string" || !encodedPath) throw new Error("The resource URI must contain exactly one encoded project path.");
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    throw new Error("The project path in the resource URI is not valid URL encoding.");
  }
}

/**
 * Register the three project resources. `deps` replaces the workspace check, the logger and the
 * resource readers in tests.
 */
export function registerProjectResources(server, deps = {}) {
  const { workspaceCheck = checkWorkspace, activityLogger = logActivity, runners = {} } = deps;
  for (const resource of PROJECT_RESOURCES) {
    server.registerResource(
      resource.name,
      new ResourceTemplate(`causly://project/{encodedPath}/${resource.kind}`, { list: undefined }),
      { title: resource.title, description: resource.description, mimeType: "application/json" },
      async (uri, { encodedPath }) => {
        const repo_path = decodeProjectPath(encodedPath);
        const check = workspaceCheck(resource.name, { repo_path });
        if (!check.allowed) {
          activityLogger(resource.name, { repo_path }, "BLOCKED", check.reason);
          throw new Error(check.reason);
        }
        const data = await (runners[resource.kind] ?? resource.run)({ repo_path });
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
      }
    );
  }
}
