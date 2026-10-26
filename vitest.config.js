import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests must not depend on the shell they run from (for example a CAUSLY_WORKSPACE set by an editor).
    setupFiles: ["./tests/helpers/cleanEnv.js"],
  },
});
