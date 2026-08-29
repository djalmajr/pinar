import { createFileRoute } from "@tanstack/react-router";
import { localCloudOnlyServerHandlers, throwIfLocalCloudLocation } from "@/lib/local-cloud-redirect";
import { SignInPage } from "@/pages/SignIn";

function internalReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "/app";
}

function SignInRoute() {
  const search = Route.useSearch();
  return <SignInPage extensionCode={search.extensionCode} returnTo={search.returnTo} />;
}

export const Route = createFileRoute("/sign-in")({
  beforeLoad: ({ location }) => {
    throwIfLocalCloudLocation(location.href, location.pathname);
  },
  component: SignInRoute,
  server: {
    handlers: localCloudOnlyServerHandlers(),
  },
  validateSearch: (search) => ({
    extensionCode: typeof search.extensionCode === "string" ? search.extensionCode : "",
    returnTo: internalReturnTo(search.returnTo),
  }),
});
