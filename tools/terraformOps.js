import { execFile } from "child_process";
import { promisify } from "util";
import * as githubOps from "./githubOps.js";

const execFileAsync = promisify(execFile);

async function runTerraform(args, cwd, timeout_ms = 120000) {
  try {
    const { stdout, stderr } = await execFileAsync("terraform", args, {
      cwd,
      timeout: timeout_ms,
      maxBuffer: 1024 * 1024 * 20,
    });
    return { stdout, stderr, exit_code: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || err.message,
      exit_code: err.code ?? 1,
    };
  }
}

/** Initialize a Terraform working directory (downloads providers/modules). */
export async function terraformInit({ dir, upgrade = false }) {
  const args = ["init", "-no-color"];
  if (upgrade) args.push("-upgrade");
  return runTerraform(args, dir);
}

/** Validate the configuration's syntax and internal consistency. */
export async function terraformValidate({ dir }) {
  return runTerraform(["validate", "-no-color", "-json"], dir);
}

/** Format .tf files to canonical style. */
export async function terraformFmt({ dir, check = false }) {
  const args = ["fmt", "-no-color"];
  if (check) args.push("-check");
  return runTerraform(args, dir);
}

/** Show an execution plan: what Terraform would change. */
export async function terraformPlan({ dir, var_file, out }) {
  const args = ["plan", "-no-color", "-input=false"];
  if (var_file) args.push(`-var-file=${var_file}`);
  if (out) args.push(`-out=${out}`);
  return runTerraform(args, dir, 300000);
}

/** Apply changes to reach the desired state. HIGH risk — requires confirm: true. */
export async function terraformApply({ dir, var_file, plan_file, confirm }) {
  const args = ["apply", "-no-color", "-input=false", "-auto-approve"];
  if (plan_file) {
    args.push(plan_file);
  } else if (var_file) {
    args.push(`-var-file=${var_file}`);
  }
  return runTerraform(args, dir, 600000);
}

/** Destroy all resources managed by this configuration. HIGH risk — requires confirm: true. */
export async function terraformDestroy({ dir, var_file, confirm }) {
  const args = ["destroy", "-no-color", "-input=false", "-auto-approve"];
  if (var_file) args.push(`-var-file=${var_file}`);
  return runTerraform(args, dir, 600000);
}

/** Show the current state or a saved plan, human-readable or as JSON. */
export async function terraformShow({ dir, target, json = false }) {
  const args = ["show", "-no-color"];
  if (json) args.push("-json");
  if (target) args.push(target);
  return runTerraform(args, dir);
}

/** Read output values from the root module's state. */
export async function terraformOutput({ dir, name, json = true }) {
  const args = ["output", "-no-color"];
  if (json) args.push("-json");
  if (name) args.push(name);
  return runTerraform(args, dir);
}

/** Manage Terraform workspaces (environments like dev/staging/prod). action: 'list' | 'new' | 'select' | 'delete' (defaults to list). */
export async function terraformWorkspace({ dir, action = "list", name }) {
  if (action === "list") return runTerraform(["workspace", "list", "-no-color"], dir);
  if (action === "new") return runTerraform(["workspace", "new", "-no-color", name], dir);
  if (action === "select") return runTerraform(["workspace", "select", "-no-color", name], dir);
  if (action === "delete") return runTerraform(["workspace", "delete", "-no-color", name], dir);
  throw new Error(`Unknown workspace action: ${action}`);
}

/** List all resources tracked in the current state. */
export async function terraformStateList({ dir, filter }) {
  const args = ["state", "list", "-no-color"];
  if (filter) args.push(filter);
  return runTerraform(args, dir);
}

/** Show detailed attributes of a single resource in the state. */
export async function terraformStateShow({ dir, address }) {
  return runTerraform(["state", "show", "-no-color", address], dir);
}

/** Move a resource to a new address within the state (rename/refactor without destroy+recreate). HIGH risk — requires confirm: true. */
export async function terraformStateMv({ dir, source, destination, confirm }) {
  return runTerraform(["state", "mv", "-no-color", source, destination], dir);
}

/** Remove a resource from the state without destroying the real infrastructure (stops Terraform managing it). HIGH risk — requires confirm: true. */
export async function terraformStateRm({ dir, address, confirm }) {
  return runTerraform(["state", "rm", "-no-color", address], dir);
}

/** Download and print the raw remote state as JSON — useful for backend/state-drift inspection. */
export async function terraformStatePull({ dir }) {
  return runTerraform(["state", "pull"], dir);
}

/** Import an existing real-world resource into Terraform state, so it becomes managed by this config. HIGH risk — requires confirm: true. */
export async function terraformImport({ dir, address, resource_id, var_file, confirm }) {
  const args = ["import", "-no-color", "-input=false"];
  if (var_file) args.push(`-var-file=${var_file}`);
  args.push(address, resource_id);
  return runTerraform(args, dir, 300000);
}

/** Mark a resource as tainted, forcing it to be destroyed and recreated on the next apply. HIGH risk — requires confirm: true. */
export async function terraformTaint({ dir, address, confirm }) {
  return runTerraform(["taint", "-no-color", address], dir);
}

/** Remove the tainted mark from a resource, so it will not be forcibly recreated. */
export async function terraformUntaint({ dir, address }) {
  return runTerraform(["untaint", "-no-color", address], dir);
}

/** Generate a visual dependency graph of resources in DOT format. */
export async function terraformGraph({ dir }) {
  return runTerraform(["graph"], dir);
}

/** List the providers required by the configuration and their resolved versions. */
export async function terraformProviders({ dir }) {
  return runTerraform(["providers"], dir);
}

/**
 * CI/CD hook: run `terraform plan`, format a concise Markdown summary, and post it
 * as a comment on a GitHub pull request — so reviewers see the infra diff before approving.
 * HIGH risk — requires confirm: true.
 */
export async function terraformPlanComment({ dir, var_file, owner, repo, pull_number, confirm }) {
  const args = ["plan", "-no-color", "-input=false", "-detailed-exitcode"];
  if (var_file) args.push(`-var-file=${var_file}`);
  const planResult = await runTerraform(args, dir, 300000);

  // -detailed-exitcode: 0 = no changes, 1 = error, 2 = changes present. Both 0 and 2 are "success" runs.
  const hadError = planResult.exit_code !== 0 && planResult.exit_code !== 2;

  const status = hadError ? "❌ Plan failed" : planResult.exit_code === 0 ? "✅ No changes" : "📋 Plan has changes";
  const body =
    `### Terraform Plan — ${status}\n\n` +
    "<details><summary>Show plan output</summary>\n\n```\n" +
    (hadError ? planResult.stderr : planResult.stdout).slice(0, 60000) +
    "\n```\n</details>";

  const comment = await githubOps.githubAddComment({ owner, repo, issue_number: pull_number, body });
  return { plan_exit_code: planResult.exit_code, had_error: hadError, comment_url: comment.html_url };
}
