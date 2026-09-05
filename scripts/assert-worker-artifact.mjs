#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const EXPECTED = {
  production: { name: "pinar-prd", targetEnvironment: "production" },
  staging: { name: "pinar-stg", targetEnvironment: "staging" },
};

export function assertWorkerArtifact(
  environment,
  artifact = JSON.parse(readFileSync(join(root, "apps/server/dist/server/wrangler.json"), "utf8")),
) {
  const expected = EXPECTED[environment];
  if (!expected) throw new Error(`unknown worker environment: ${environment}`);
  if (artifact.targetEnvironment !== expected.targetEnvironment) {
    throw new Error(`artifact targetEnvironment is ${artifact.targetEnvironment}; expected ${expected.targetEnvironment}`);
  }
  if (artifact.name !== expected.name) {
    throw new Error(`artifact worker is ${artifact.name}; expected ${expected.name}`);
  }
  return { name: artifact.name, targetEnvironment: artifact.targetEnvironment };
}

if (import.meta.main) {
  const environment = process.argv[2];
  const result = assertWorkerArtifact(environment);
  console.log(`assert-worker-artifact: ${result.targetEnvironment} ${result.name}`);
}
