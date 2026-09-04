---
sidebar_position: 5
---

# Docker

18 tools wrapping the Docker CLI — cross-platform by design. Implemented in `tools/dockerOps.js`.

## Setup

No API key required. The server tries plain `docker` first — this covers macOS, Linux, and
Windows with Docker Desktop. If that fails and you're on Windows, it automatically falls back to
`wsl docker ...`, covering setups where Docker only exists inside WSL (no Docker Desktop
installed). Windows-style paths (`D:\...`) passed to `docker_build`, `docker_run` (volumes), or
`docker_compose_up`/`down` are automatically translated to their WSL equivalent
(`/mnt/d/...`) when the WSL fallback is used.

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `docker_version` | READ | Connectivity check |
| `docker_ps` | READ | List containers |
| `docker_images` | READ | List images |
| `docker_build` | HIGH | Build an image from a Dockerfile |
| `docker_run` | HIGH | Run a new container |
| `docker_stop` | HIGH | Stop a running container |
| `docker_start` | LOW | Start a stopped container |
| `docker_restart` | HIGH | Restart a container |
| `docker_remove` | DESTRUCTIVE | Remove a container |
| `docker_remove_image` | DESTRUCTIVE | Remove an image |
| `docker_logs` | READ | Get logs from a container |
| `docker_inspect` | READ | Full JSON metadata for a container/image |
| `docker_exec` | MEDIUM | Run a command inside a running container |
| `docker_stats` | READ | Live CPU/memory snapshot |
| `docker_push` | HIGH | Push an image to a registry |
| `docker_pull` | LOW | Pull an image from a registry |
| `docker_compose_up` | HIGH | `docker compose up` for a project directory |
| `docker_compose_down` | HIGH | `docker compose down` for a project directory |

## Example

```
"Build the image in ./app as myapp:latest, then run it detached on port 8080."
```

Claude calls `docker_build` (confirm: true) → `docker_run` with `ports: ["8080:80"]`.
