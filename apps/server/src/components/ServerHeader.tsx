import { type ReactNode, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PinarMark,
} from "@pinar/ui";
import { useAuthSession } from "@/lib/auth-session";
import { SERVER_LANGUAGES, useServerI18n } from "@/lib/i18n";
import { pinarRuntime, publicHeaderCta, publicHeaderShowsPlans } from "@/lib/server-header";
import CheckIcon from "~icons/lucide/check";
import LanguagesIcon from "~icons/lucide/languages";
import HomeIcon from "~icons/lucide/house";
import LogInIcon from "~icons/lucide/log-in";
import MenuIcon from "~icons/lucide/menu";
import MoonIcon from "~icons/lucide/moon";
import PanelsTopLeftIcon from "~icons/lucide/panels-top-left";
import SunIcon from "~icons/lucide/sun";
import TagIcon from "~icons/lucide/tags";
import GitHubIcon from "~icons/radix-icons/github-logo";

type ServerPage = "home" | "pricing" | "signIn";

export interface ServerHeaderProps {
  actions?: ReactNode;
  activePage?: ServerPage;
  context?: ReactNode;
}

export function ServerHeader({ actions, activePage, context }: ServerHeaderProps) {
  const { language, languageName, setLanguage, t } = useServerI18n();
  const session = useAuthSession();
  const runtime = pinarRuntime();
  const headerCta = publicHeaderCta(session, runtime);
  const showPlans = publicHeaderShowsPlans(runtime);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    document.documentElement.setAttribute("data-theme", nextDark ? "dark" : "light");
    localStorage.setItem("pinar-theme", nextDark ? "dark" : "light");
  }

  return (
    <header className="relative z-30 shrink-0 border-b bg-card/95 backdrop-blur">
      <div className="relative mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-5">
        <Link aria-label={t("common.pinarHome")} className="flex shrink-0 items-center gap-2" preload="intent" to="/">
          <PinarMark className="size-5" />
          <span className="text-sm font-bold">Pinar</span>
        </Link>

        <nav
          aria-label={t("common.primaryNavigation")}
          className={cn("hidden shrink-0 items-center gap-1 md:flex", !context && "absolute left-1/2 -translate-x-1/2")}
        >
          <Button
            render={<Link aria-current={activePage === "home" ? "page" : undefined} preload="intent" to="/" />}
            size="sm"
            variant={activePage === "home" ? "secondary" : "ghost"}
          >
            <HomeIcon data-icon="inline-start" />
            {t("common.home")}
          </Button>
          {showPlans ? (
            <Button
              render={<Link aria-current={activePage === "pricing" ? "page" : undefined} preload="intent" to="/pricing" />}
              size="sm"
              variant={activePage === "pricing" ? "secondary" : "ghost"}
            >
              <TagIcon data-icon="inline-start" />
              {t("common.plans")}
            </Button>
          ) : null}
        </nav>

        {context ? <div className="min-w-0 flex-1 border-l pl-4">{context}</div> : <div className="flex-1" />}

        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button aria-label={t("common.primaryNavigation")} className="md:hidden" size="icon-sm" variant="ghost" />}>
              <MenuIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 md:hidden">
              <DropdownMenuItem render={<Link preload="intent" to="/" />}><HomeIcon />{t("common.home")}</DropdownMenuItem>
              {showPlans ? (
                <DropdownMenuItem render={<Link preload="intent" to="/pricing" />}><TagIcon />{t("common.plans")}</DropdownMenuItem>
              ) : null}
              {headerCta === "open-app" ? (
                <DropdownMenuItem render={<Link preload="intent" search={{ session: undefined }} to="/app" />}><PanelsTopLeftIcon />{t("common.openApp")}</DropdownMenuItem>
              ) : (
                <DropdownMenuItem render={<Link preload="intent" search={{ extensionCode: "", returnTo: "/app" }} to="/sign-in" />}><LogInIcon />{t("common.signIn")}</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t("common.language")}
                  size="icon-sm"
                  title={`${t("common.language")}: ${languageName(language)}`}
                  variant="ghost"
                />
              }
            >
              <LanguagesIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuGroup>
                {SERVER_LANGUAGES.map((candidate) => (
                  <DropdownMenuItem key={candidate} onClick={() => setLanguage(candidate)}>
                    <span className="flex-1">{languageName(candidate)}</span>
                    {candidate === language && <CheckIcon />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button aria-label={t("common.toggleTheme")} size="icon-sm" title={t("common.toggleTheme")} variant="ghost" onClick={toggleTheme}>
            {isDark ? <SunIcon /> : <MoonIcon />}
          </Button>
          <Button
            aria-label="GitHub"
            className="hidden sm:inline-flex"
            render={<a href="https://github.com/djalmajr/pinar" rel="noopener noreferrer" target="_blank" />}
            size="icon-sm"
            title="GitHub"
            variant="ghost"
          >
            <GitHubIcon />
          </Button>
          {headerCta === "open-app" ? (
            <Button
              className="hidden md:inline-flex"
              render={<Link preload="intent" search={{ session: undefined }} to="/app" />}
              size="sm"
              variant="pro"
            >
              <PanelsTopLeftIcon data-icon="inline-start" />
              {t("common.openApp")}
            </Button>
          ) : (
            <Button
              className="hidden md:inline-flex"
              render={<Link aria-current={activePage === "signIn" ? "page" : undefined} preload="intent" search={{ extensionCode: "", returnTo: "/app" }} to="/sign-in" />}
              size="sm"
              variant="pro"
            >
              <LogInIcon data-icon="inline-start" />
              {t("common.signIn")}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
