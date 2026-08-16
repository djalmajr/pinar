import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/pages/Pricing";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});
