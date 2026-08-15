import { useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  ScrollArea,
} from "@pinar/ui";
import IconArrowLeft from "~icons/lucide/arrow-left";
import IconCheck from "~icons/lucide/check";
import IconCoffee from "~icons/lucide/coffee";
import IconSparkles from "~icons/lucide/sparkles";
import IconLock from "~icons/lucide/lock";
import IconHeart from "~icons/lucide/heart";
import IconMoon from "~icons/lucide/moon";
import IconSun from "~icons/lucide/sun";

export function PricingPage() {
  const [loadingInterval, setLoadingInterval] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  async function startCheckout(interval: "month" | "year" | "lifetime") {
    setLoadingInterval(interval);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Error: " + (data.error || "Failed to initialize checkout"));
      }
    } catch (error) {
      alert(`Network error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingInterval(null);
    }
  }

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.setAttribute("data-theme", nextDark ? "dark" : "light");
    localStorage.setItem("pinar-theme", nextDark ? "dark" : "light");
  }

  return (
    <ScrollArea className="h-screen bg-background text-foreground">
      <div className="flex min-h-full flex-col items-center px-4 py-12">
      <div className="max-w-4xl w-full flex items-center justify-between mb-8">
        <Button render={<a href="/history" />} size="sm" variant="outline">
          <IconArrowLeft data-icon="inline-start" />
          Back to Dashboard
        </Button>
        <Button
          aria-label="Toggle theme"
          size="icon"
          title="Toggle theme"
          variant="outline"
          onClick={toggleTheme}
        >
          {isDark ? <IconSun /> : <IconMoon />}
        </Button>
      </div>

      <div className="max-w-4xl w-full flex flex-col items-center text-center mb-12">
        <Badge variant="pro" className="mb-4">
          <IconSparkles className="w-3.5 h-3.5 mr-1" />
          Pinar Pro & Sponsors
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
          Keep every bug & visual feedback forever
        </h1>
        <p className="text-muted-foreground text-base max-w-xl">
          Supercharge Pinar with unlimited permanent retention, dedicated cloud
          storage, and interactive web links that never break.
        </p>
      </div>

      <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {/* Free Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-xl">Free</CardTitle>
            <CardDescription className="min-h-[38px]">
              100% private local development and quick testing.
            </CardDescription>
            <div className="pt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold">$0</span>
              <span className="text-sm text-muted-foreground">forever</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="flex flex-col gap-2.5 text-xs">
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                100% Free Local Helper & CLI
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                7-Day Cloud Retention
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                Standard Web Viewer
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                One-Click Clipboard AI Prompts
              </li>
            </ul>
          </CardContent>
          <CardFooter>
            <a href="https://github.com/djalmajr/pinar" target="_blank" className="w-full">
              <Button variant="outline" className="w-full">
                Use Free
              </Button>
            </a>
          </CardFooter>
        </Card>

        {/* Pro Yearly Card (Popular) */}
        <Card className="border-primary shadow-lg relative flex flex-col justify-between bg-card/80">
          <div className="absolute -top-3 right-6">
            <Badge variant="default" className="text-[10px] tracking-wider font-extrabold">
              BEST VALUE
            </Badge>
          </div>
          <CardHeader>
            <CardTitle className="text-xl">Pro Yearly</CardTitle>
            <CardDescription className="min-h-[38px]">
              Permanent retention for less than $1.60/month.
            </CardDescription>
            <div className="pt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold">$19</span>
              <span className="text-sm text-muted-foreground">/ year (~$1.58/mo)</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="flex flex-col gap-2.5 text-xs">
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span><strong>Permanent Retention</strong> (Never Deleted)</span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span><strong>Permanent Web Viewers</strong> for PRs</span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span><strong>5 GB Dedicated Cloud Storage</strong></span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span>Lifetime Search Across History</span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span>1-Click License Key Activation</span>
              </li>
            </ul>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button
              variant="default"
              className="w-full"
              disabled={loadingInterval !== null}
              onClick={() => startCheckout("year")}
            >
              {loadingInterval === "year" ? "Redirecting…" : "Get Pro Yearly — $19/yr"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground w-full"
              disabled={loadingInterval !== null}
              onClick={() => startCheckout("month")}
            >
              {loadingInterval === "month" ? "Redirecting…" : "Or Pay Monthly ($2.90/mo)"}
            </Button>
          </CardFooter>
        </Card>

        {/* Lifetime Deal Card */}
        <Card className="border-emerald-500/50 shadow-md relative flex flex-col justify-between">
          <div className="absolute -top-3 right-6">
            <Badge variant="success" className="text-[10px] tracking-wider font-extrabold">
              EARLY BIRD
            </Badge>
          </div>
          <CardHeader>
            <CardTitle className="text-xl">Lifetime Deal</CardTitle>
            <CardDescription className="min-h-[38px]">
              Pay once, keep forever. No recurring charges.
            </CardDescription>
            <div className="pt-4 flex items-baseline gap-1">
              <span className="text-3xl font-bold">$49</span>
              <span className="text-sm text-muted-foreground">one-time payment</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="flex flex-col gap-2.5 text-xs">
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span><strong>Lifetime Pro Access</strong> (No Subscriptions)</span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span><strong>Permanent Web Viewers Forever</strong></span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span><strong>5 GB Cloud Storage Included</strong></span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span>All future Pro features included</span>
              </li>
              <li className="flex items-center gap-2">
                <IconCheck className="text-emerald-500 w-4 h-4 shrink-0" />
                <span>Early Adopter VIP Badge</span>
              </li>
            </ul>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white border-none"
              disabled={loadingInterval !== null}
              onClick={() => startCheckout("lifetime")}
            >
              {loadingInterval === "lifetime" ? "Redirecting…" : "Get Lifetime Pro — $49"}
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Open-Source Support Section */}
      <div className="max-w-4xl w-full p-6 rounded-2xl border border-border bg-card/60 flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
        <div className="text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold sm:justify-start">
            <IconHeart className="size-4 fill-pink-500 text-pink-500" />
            Support via Open Source Sponsorship
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Prefer supporting open-source development directly? Sponsor on GitHub or buy a coffee.
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap justify-center">
          <a href="https://github.com/sponsors/djalmajr" target="_blank" rel="noopener noreferrer">
            <Button variant="sponsor" size="sm" className="h-8 text-xs">
              <IconHeart className="w-3.5 h-3.5 text-pink-500 fill-pink-500 mr-1" />
              Sponsor on GitHub
            </Button>
          </a>
          <Button
            className="h-8 border-amber-500/30 bg-amber-500/10 text-xs text-amber-500 hover:bg-amber-500/20"
            render={<a href="https://buymeacoffee.com/djalmajr" rel="noopener noreferrer" target="_blank" />}
            size="sm"
            variant="outline"
          >
            <IconCoffee data-icon="inline-start" />
            Buy Me a Coffee
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconLock className="w-3.5 h-3.5" />
        Secure checkout powered by Stripe • Cancel anytime with 1 click
      </div>
      </div>
    </ScrollArea>
  );
}
