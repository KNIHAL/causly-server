// Child process for tests/privateFiles.test.js: starts a secrets write and dies at the worst moment,
// after the temporary file is complete and before it is renamed over the real store.
import fs from "fs";

const storePath = process.argv[2];
const { secretsSet } = await import("../../tools/secretsOps.js");

fs.renameSync = () => {
  process.exit(137);
};

await secretsSet({ name: "NEW", value: "new-value", store_path: storePath, confirm: true });
process.exit(0); // not reached when the crash works
