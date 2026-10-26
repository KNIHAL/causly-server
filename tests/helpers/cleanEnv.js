for (const name of Object.keys(process.env)) {
  if (name.startsWith("CAUSLY_")) delete process.env[name];
}
