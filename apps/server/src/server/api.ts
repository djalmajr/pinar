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
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

function runtimeEnv(source: Cloudflare.Env & SecretEnv): CloudEnv {
  return {
    ADMIN_API_KEY: source.ADMIN_API_KEY,
    AI: source.AI,
    AUTH_PEPPER: source.AUTH_PEPPER,
    DB: source.DB,
    DEPLOYMENT_ENV: source.DEPLOYMENT_ENV,
    EMAIL: source.EMAIL,
    EXTENSION_ORIGIN: source.EXTENSION_ORIGIN,
    PINAR_BUCKET: source.PINAR_BUCKET,
    PRICING_AI_CREDITS_500_BRL_CENTS: source.PRICING_AI_CREDITS_500_BRL_CENTS,
    PRICING_AI_CREDITS_500_USD_CENTS: source.PRICING_AI_CREDITS_500_USD_CENTS,
    PRICING_STORAGE_1GB_12M_BRL_CENTS: source.PRICING_STORAGE_1GB_12M_BRL_CENTS,
    PRICING_STORAGE_1GB_12M_USD_CENTS: source.PRICING_STORAGE_1GB_12M_USD_CENTS,
    PRICING_STORAGE_5GB_12M_BRL_CENTS: source.PRICING_STORAGE_5GB_12M_BRL_CENTS,
    PRICING_STORAGE_5GB_12M_USD_CENTS: source.PRICING_STORAGE_5GB_12M_USD_CENTS,
    PRICING_YEARLY_BRL_CENTS: source.PRICING_YEARLY_BRL_CENTS,
    PRICING_YEARLY_USD_CENTS: source.PRICING_YEARLY_USD_CENTS,
    STRIPE_PRICE_AI_CREDITS_500: source.STRIPE_PRICE_AI_CREDITS_500,
    STRIPE_PRICE_BR_AI_CREDITS_500: source.STRIPE_PRICE_BR_AI_CREDITS_500,
    STRIPE_PRICE_BR_STORAGE_1GB_12M: source.STRIPE_PRICE_BR_STORAGE_1GB_12M,
    STRIPE_PRICE_BR_STORAGE_5GB_12M: source.STRIPE_PRICE_BR_STORAGE_5GB_12M,
    STRIPE_PRICE_BR_YEARLY: source.STRIPE_PRICE_BR_YEARLY,
    STRIPE_PRICE_STORAGE_1GB_12M: source.STRIPE_PRICE_STORAGE_1GB_12M,
    STRIPE_PRICE_STORAGE_5GB_12M: source.STRIPE_PRICE_STORAGE_5GB_12M,
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
