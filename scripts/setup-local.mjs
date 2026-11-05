// Creates .dev.vars from the example with a fresh random SESSION_SECRET. Never overwrites an existing file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".dev.vars")) {
  console.log(".dev.vars already exists, leaving it as it is.");
} else {
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(".dev.vars", readFileSync(".dev.vars.example", "utf8").replace("replace-me", secret));
  console.log("Created .dev.vars");
}
