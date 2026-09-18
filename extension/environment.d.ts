export type PinarCloudEnvironment = "local-cloud" | "production" | "staging";

export const DEVELOPMENT_EXTENSION_KEY: string;
export const DEVELOPMENT_EXTENSION_ID: string;
export const PRODUCTION_CLOUD_URL: string;
export const STAGING_CLOUD_URL: string;

export function isDevelopmentExtension(manifest: { key?: string } | null | undefined): boolean;
export function resolveCloudUrl(manifest: { key?: string } | null | undefined, storedCloudUrl?: string): string;
export function cloudEnvironment(manifest: { key?: string } | null | undefined, storedCloudUrl?: string): PinarCloudEnvironment;
export function requiresExplicitLegalConsent(manifest: { key?: string } | null | undefined, storedCloudUrl?: string): boolean;
