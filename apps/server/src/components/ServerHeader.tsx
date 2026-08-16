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
import { SERVER_LANGUAGES, useServerI18n } from "@/lib/i18n";
import CheckIcon from "~icons/lucide/check";
import LanguagesIcon from "~icons/lucide/languages";
import HomeIcon from "~icons/lucide/house";
import DashboardIcon from "~icons/lucide/layout-dashboard";
import MoonIcon from "~icons/lucide/moon";
import SunIcon from "~icons/lucide/sun";
import TagIcon from "~icons/lucide/tags";
import GitHubIcon from "~icons/radix-icons/github-logo";

type ServerPage = "dashboard" | "history" | "home" | "pricing";

export interface ServerHeaderProps {
  actions?: ReactNode;
  activePage?: ServerPage;
  context?: ReactNode;
}

export function ServerHeader({ actions, activePage, context }: ServerHeaderProps) {
  const { language, languageName, setLanguage, t } = useServerI18n();
  const [isDark, setIsDark] = useState(false);
  const isDashboard = activePage === "dashboard" || activePage === "history";
  const showSubscribeAction = !actions && !context && activePage !== "pricing";

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
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-4 border-b bg-card/95 px-5 backdrop-blur">
      <Link aria-label={t("common.pinarHome")} className="flex shrink-0 items-center gap-2" preload="intent" to="/">
        <PinarMark className="size-5" />
        <span className="text-sm font-bold">Pinar</span>
      </Link>

      <nav
        aria-label={t("common.primaryNavigation")}
        className={cn("flex shrink-0 items-center gap-1", !context && "absolute left-1/2 -translate-x-1/2")}
      >
        <Button
          render={<Link aria-current={activePage === "home" ? "page" : undefined} preload="intent" to="/" />}
          size="sm"
          variant={activePage === "home" ? "secondary" : "ghost"}
        >
          <HomeIcon data-icon="inline-start" />
          {t("common.home")}
        </Button>
        <Button
          render={<Link aria-current={isDashboard ? "page" : undefined} preload="intent" to="/history" />}
          size="sm"
          variant={isDashboard ? "secondary" : "ghost"}
        >
          <DashboardIcon data-icon="inline-start" />
          {t("common.dashboard")}
        </Button>
        <Button
          render={<Link aria-current={activePage === "pricing" ? "page" : undefined} preload="intent" to="/pricing" />}
          size="sm"
          variant={activePage === "pricing" ? "secondary" : "ghost"}
        >
          <TagIcon data-icon="inline-start" />
          {t("common.plans")}
        </Button>
      </nav>

      {context ? <div className="min-w-0 flex-1 border-l pl-4">{context}</div> : <div className="flex-1" />}

      <div className="flex shrink-0 items-center gap-2">
        {actions}
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
          render={<a href="https://github.com/djalmajr/pinar" rel="noopener noreferrer" target="_blank" />}
          size="icon-sm"
          title="GitHub"
          variant="ghost"
        >
          <GitHubIcon />
        </Button>
        {showSubscribeAction && (
          <Button className="hidden md:inline-flex" render={<Link preload="intent" to="/pricing" />} size="sm" variant="pro">
            {t("common.subscribe")}
          </Button>
        )}
      </div>
    </header>
  );
}
