import { env } from "cloudflare:workers";
import {
  type CloudEnv,
  authorizeCloudAppRequest,
  handleCloudApiRequest,
  handleCloudPublicRequest,
} from "./cloud-api";

interface SecretEnv {
  ADMIN_API_KEY?: string;
  AUTH_PEPPER?: string;
  EMAIL?: SendEmail;
  EXTENSION_ORIGIN?: string;
  STRIPE_PRICE_BR_LIFETIME?: string;
  STRIPE_PRICE_BR_MONTHLY?: string;
  STRIPE_PRICE_BR_YEARLY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

function runtimeEnv(source: Cloudflare.Env & SecretEnv): CloudEnv {
  return {
    ADMIN_API_KEY: source.ADMIN_API_KEY,
    AUTH_PEPPER: source.AUTH_PEPPER,
    DB: source.DB,
    EMAIL: source.EMAIL,
    EXTENSION_ORIGIN: source.EXTENSION_ORIGIN,
    PINAR_BUCKET: source.PINAR_BUCKET,
    PRICING_BR_DISCOUNT_PERCENT: source.PRICING_BR_DISCOUNT_PERCENT,
    PRICING_BR_EXCHANGE_RATE: source.PRICING_BR_EXCHANGE_RATE,
    PRICING_LIFETIME_USD_CENTS: source.PRICING_LIFETIME_USD_CENTS,
    PRICING_MONTHLY_USD_CENTS: source.PRICING_MONTHLY_USD_CENTS,
    PRICING_YEARLY_USD_CENTS: source.PRICING_YEARLY_USD_CENTS,
    STRIPE_PRICE_BR_LIFETIME: source.STRIPE_PRICE_BR_LIFETIME,
    STRIPE_PRICE_BR_MONTHLY: source.STRIPE_PRICE_BR_MONTHLY,
    STRIPE_PRICE_BR_YEARLY: source.STRIPE_PRICE_BR_YEARLY,
    STRIPE_PRICE_LIFETIME: source.STRIPE_PRICE_LIFETIME,
    STRIPE_PRICE_MONTHLY: source.STRIPE_PRICE_MONTHLY,
    STRIPE_PRICE_YEARLY: source.STRIPE_PRICE_YEARLY,
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: source.STRIPE_WEBHOOK_SECRET,
  };
}

export function authorizeAppRequest(request: Request) {
  return authorizeCloudAppRequest(request, runtimeEnv(env));
}

export function handleApiRequest(request: Request) {
  return handleCloudApiRequest(request, runtimeEnv(env));
}

export function handlePublicRequest(request: Request) {
  return handleCloudPublicRequest(request, runtimeEnv(env));
}
