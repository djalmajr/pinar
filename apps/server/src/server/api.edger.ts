import type { CloudEnv } from "./cloud-api";
import {
  authorizeCloudAppRequest,
  handleCloudApiRequest,
  handleCloudPublicRequest,
} from "./cloud-api";
import { runtimeEnv } from "./cloud-env";
import { edgerCloudEnv } from "./edger/env";

// The minimal shape of the Deno global this file relies on; the project does
// not depend on Deno's types.
interface DenoEnvLike {
  get(name: string): string | undefined;
}
interface DenoLike {
  env: DenoEnvLike;
}

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: DenoLike }).Deno;
  if (deno) return deno.env.get(name);
  return process.env[name];
}

let cachedEnv: CloudEnv | undefined;

// Built once per process: the EdgeR worker reads its configuration from
// environment variables at startup and keeps the result.
export function getEdgerCloudEnv(): CloudEnv {
  if (!cachedEnv) {
    cachedEnv = edgerCloudEnv(readEnv);
  }
  return cachedEnv;
}

export function authorizeAppRequest(request: Request) {
  return authorizeCloudAppRequest(request, runtimeEnv(getEdgerCloudEnv()));
}

export function handleApiRequest(request: Request) {
  return handleCloudApiRequest(request, runtimeEnv(getEdgerCloudEnv()));
}

export function handlePublicRequest(request: Request) {
  return handleCloudPublicRequest(request, runtimeEnv(getEdgerCloudEnv()));
}
