import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests must not depend on the shell they run from (for example a CAUSLY_WORKSPACE set by an editor).
    setupFiles: ["./tests/helpers/cleanEnv.js"],
    // CI runners (especially Windows) are slow on first import and process spawn; the 5s default makes tests flaky there.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
