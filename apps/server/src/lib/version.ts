import rootPackage from "../../../../package.json";

/**
 * The product version is the root package.json version: the same number git
 * tags carry, release notes are keyed by, and /api/health reports. Vite bakes
 * it in as VITE_PINAR_VERSION; outside a Vite build (tests) the root file is
 * read directly. apps/server/package.json used to be the footer's source and
 * silently fell behind - it is no longer a source of anything user-visible.
 */
export const SERVER_VERSION: string = import.meta.env?.VITE_PINAR_VERSION || rootPackage.version;

/**
 * Empty when the build came from the release tag; the short commit otherwise.
 * A build ahead of the last release must not pass for that release.
 */
export const SERVER_BUILD: string = import.meta.env?.VITE_PINAR_BUILD || "";

export const SERVER_VERSION_LABEL = SERVER_BUILD ? `${SERVER_VERSION}+${SERVER_BUILD}` : SERVER_VERSION;
