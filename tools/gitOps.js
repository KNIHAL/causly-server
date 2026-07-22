import { simpleGit } from "simple-git";

function getGit(repoPath) {
  return simpleGit({ baseDir: repoPath });
}

export async function gitInit({ repo_path }) {
  const git = getGit(repo_path);
  const result = await git.init();
  return { repo_path, initialized: true, result };
}

export async function gitStatus({ repo_path }) {
  const git = getGit(repo_path);
  const status = await git.status();
  return { repo_path, status };
}

export async function gitAdd({ repo_path, files = "." }) {
  const git = getGit(repo_path);
  await git.add(files);
  return { repo_path, added: files };
}

export async function gitCommit({ repo_path, message }) {
  const git = getGit(repo_path);
  const result = await git.commit(message);
  return { repo_path, commit: result };
}

export async function gitPush({ repo_path, remote = "origin", branch }) {
  const git = getGit(repo_path);
  const result = branch ? await git.push(remote, branch) : await git.push();
  return { repo_path, result };
}

export async function gitPull({ repo_path, remote = "origin", branch }) {
  const git = getGit(repo_path);
  const result = branch ? await git.pull(remote, branch) : await git.pull();
  return { repo_path, result };
}

export async function gitLog({ repo_path, max_count = 10 }) {
  const git = getGit(repo_path);
  const log = await git.log({ maxCount: max_count });
  return { repo_path, log: log.all };
}

export async function gitDiff({ repo_path, file }) {
  const git = getGit(repo_path);
  const diff = file ? await git.diff([file]) : await git.diff();
  return { repo_path, diff };
}

export async function gitBranch({ repo_path }) {
  const git = getGit(repo_path);
  const branches = await git.branch();
  return { repo_path, branches };
}
