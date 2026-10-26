import { z } from "zod";
import * as commandOps from "../tools/commandOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
// ---------------- Command execution ----------------

server.registerTool(
  "run_command",
  {
    description:
      "Run a shell command in a given working directory (npm install, npm run build, pip install, tests, etc.). A short list of catastrophic patterns (drive wipes, format, shutdown) is blocked; everything else executes with full permissions. HIGH risk — requires confirm: true.",
    inputSchema: {
      command: z.string().describe("The shell command to run"),
      cwd: z.string().describe("Working directory to run the command in"),
      timeout_ms: z.number().optional().describe("Timeout in ms, default 60000"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("run_command", commandOps.runCommand)
);
}
