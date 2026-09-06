#!/usr/bin/env node
import fs from "fs";
import { pathToFileURL } from "url";
import { verifyBoundaryAttestReceipt } from "./boundaryAttest.js";

export function verifyReceiptFile(receiptPath, expectedPublicKeyPath) {
  return verifyBoundaryAttestReceipt(fs.readFileSync(receiptPath, "utf8"), fs.readFileSync(expectedPublicKeyPath, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , receiptPath, expectedPublicKeyPath] = process.argv;
  if (!receiptPath || !expectedPublicKeyPath) {
    console.error("Usage: node tools/verifyBoundaryAttest.js <receipt.json> <expected-ed25519-public-key.pem>");
    process.exitCode = 2;
  } else {
    try {
      const result = verifyReceiptFile(receiptPath, expectedPublicKeyPath);
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    } catch (err) {
      console.log(JSON.stringify({ ok: false, reason: "read_error", detail: err.message }));
      process.exitCode = 1;
    }
  }
}
