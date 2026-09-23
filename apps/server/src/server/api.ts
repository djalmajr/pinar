import { env } from "cloudflare:workers";
import {
  authorizeCloudAppRequest,
  handleCloudApiRequest,
  handleCloudPublicRequest,
} from "./cloud-api";
import { runtimeEnv } from "./cloud-env";

export function authorizeAppRequest(request: Request) {
  return authorizeCloudAppRequest(request, runtimeEnv(env));
}

export function handleApiRequest(request: Request) {
  return handleCloudApiRequest(request, runtimeEnv(env));
}

export function handlePublicRequest(request: Request) {
  return handleCloudPublicRequest(request, runtimeEnv(env));
}
