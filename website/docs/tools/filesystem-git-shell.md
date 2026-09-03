---
sidebar_position: 13
---

# Filesystem, Git & Shell

The primitive layer everything else builds on — 31 tools across `fileOps.js`,
`directoryOps.js`, `gitOps.js`, and `commandOps.js`. No API keys required — these operate
directly on your local filesystem and git repositories.

## Filesystem

| Tool | Risk | What it does |
|---|---|---|
| `read_file` | READ | Read the full text content of a single file |
| `read_multiple_files` | READ | Read several files in one call |
| `create_file` | LOW | Create a brand-new file |
| `write_file` | MEDIUM | Create or completely overwrite a file with new content |
| `edit_file` | MEDIUM | Exact string find-and-replace, without rewriting the whole file |
| `delete_file` | HIGH | Delete a single file |
| `move_file` | MEDIUM | Move or rename a file or directory |
| `copy_file` | LOW | Copy a single file to a new location |
| `get_file_info` | READ | Get metadata — size, type, created/modified timestamps |

`edit_file` requires an exact match for the text being replaced — the same targeted-patch
approach used throughout this documentation to hand off code changes without re-reading (and
re-paying tokens for) an entire large file.

## Directories

| Tool | Risk | What it does |
|---|---|---|
| `list_directory` | READ | List the immediate files and subfolders inside a directory |
| `directory_tree` | READ | Recursively build a tree view of a directory's contents |
| `create_directory` | LOW | Create a new directory, including missing parents |
| `delete_directory` | HIGH | Delete a directory |
| `search_files` | READ | Recursively search for files/folders whose name matches a pattern |

## Git — full lifecycle, 20 tools

| Tool | Risk | What it does |
|---|---|---|
| `git_init` | LOW | Initialize a new git repository |
| `git_status` | READ | Show the working tree status |
| `git_add` | LOW | Stage files for commit |
| `git_commit` | MEDIUM | Commit staged changes with a message |
| `git_push` | HIGH | Push commits to a remote |
| `git_pull` | MEDIUM | Pull changes from a remote |
| `git_log` | READ | Show recent commit history |
| `git_diff` | READ | Show uncommitted changes, optionally scoped to one file |
| `git_diff_stat` | READ | Summary of changes (files/insertions/deletions) rather than full diff |
| `git_branch` | READ | List local branches and show the current branch |
| `git_create_branch` | LOW | Create a new local branch, optionally checking it out |
| `git_checkout` | MEDIUM | Checkout an existing local branch |
| `git_merge` | HIGH | Merge a branch into the current branch |
| `git_reset` | HIGH | Reset the current branch to a ref |
| `git_stash` | MEDIUM | Stash working changes |
| `git_show` | READ | Show details of a commit or object |
| `git_remote` | READ | Manage/inspect git remotes |
| `git_tag` | LOW | Manage tags |
| `git_changed_files` | READ | List changed files with their change type (modified/untracked) |
| `git_check_clean` | READ | Check whether the working tree is clean |

## Shell

**`run_command`** (risk varies by content) — executes an arbitrary shell command, scanned by the
[security layer](../architecture#4-command-and-path-risk-scanning) for both hard-blocked
destructive patterns (drive wipes, `format`, `shutdown`) and elevated-risk-but-flaggable ones
(force-push, `DROP TABLE`, `curl | bash`, `sudo`) before running.

On Windows, this runs through PowerShell rather than `cmd.exe`, so multi-statement scripts and
PowerShell-native commands work correctly instead of failing on syntax `cmd.exe` doesn't
understand.

## Example

```
"Show me what changed since the last commit, then commit it as 'fix: handle empty
response from API'."
```

Claude calls `git_diff` → `git_add` → `git_commit` with your message.
