import { env } from "cloudflare:workers";
import {
  type CloudEnv,
  authorizeCloudHistoryRequest,
  handleCloudApiRequest,
  handleCloudPublicRequest,
} from "./cloud-api";

interface SecretEnv {
  API_KEY?: string;
  AUTH_KEY?: string;
  PINAR_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
}

function runtimeEnv(source: Cloudflare.Env & SecretEnv): CloudEnv {
  return {
    API_KEY: source.API_KEY,
    AUTH_KEY: source.AUTH_KEY,
    DB: source.DB,
    PINAR_API_KEY: source.PINAR_API_KEY,
    PINAR_BUCKET: source.PINAR_BUCKET,
    STRIPE_PRICE_LIFETIME: source.STRIPE_PRICE_LIFETIME,
    STRIPE_PRICE_MONTHLY: source.STRIPE_PRICE_MONTHLY,
    STRIPE_PRICE_YEARLY: source.STRIPE_PRICE_YEARLY,
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
  };
}

export function authorizeHistoryRequest(request: Request) {
  return authorizeCloudHistoryRequest(request, runtimeEnv(env));
}

export function handleApiRequest(request: Request) {
  return handleCloudApiRequest(request, runtimeEnv(env));
}

export function handlePublicRequest(request: Request) {
  return handleCloudPublicRequest(request, runtimeEnv(env));
}
