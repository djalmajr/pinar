import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  cn,
} from "@pinar/ui";
import {
  ImageZoomControls,
  ImageZoomStage,
  useImageZoom,
} from "@/components/ImageZoomStage";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { ServerFooter } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import { useDocumentMeta } from "@/lib/document-meta";
import {
  articlesInCategory,
  defaultHelpContent,
  findHelpArticle,
  findHelpCategory,
  loadHelpContent,
  searchHelpArticles,
  type HelpCategoryId,
  type HelpContent,
  type HelpScreenshot,
} from "@/lib/help-content";
import { formatMessage, useServerI18n } from "@/lib/i18n";
import { useLocalizedContent } from "@/lib/use-localized-content";
import ArrowLeftIcon from "~icons/lucide/arrow-left";
import ArrowRightIcon from "~icons/lucide/arrow-right";
import BotIcon from "~icons/lucide/bot";
import CheckCircleIcon from "~icons/lucide/circle-check-big";
import ClockIcon from "~icons/lucide/clock-3";
import CloudIcon from "~icons/lucide/cloud";
import FolderTreeIcon from "~icons/lucide/folder-tree";
import LockIcon from "~icons/lucide/lock-keyhole";
import MapPinIcon from "~icons/lucide/map-pin";
import SearchIcon from "~icons/lucide/search";
import SparklesIcon from "~icons/lucide/sparkles";

const categoryIcons: Record<
  HelpCategoryId,
  ComponentType<{ className?: string }>
> = {
  agents: BotIcon,
  captures: MapPinIcon,
  cloud: CloudIcon,
  "getting-started": SparklesIcon,
  privacy: LockIcon,
  workspace: FolderTreeIcon,
};

const HelpContentContext = createContext<HelpContent | null>(null);

function useActiveHelpContent() {
  const content = useContext(HelpContentContext);
  if (!content) throw new Error("Help content must be loaded before rendering");
  return content;
}

function HelpContentBoundary({ children }: { children: ReactNode }) {
  const { language } = useServerI18n();
  const content = useLocalizedContent(
    "help",
    language,
    loadHelpContent,
    defaultHelpContent,
  );

  return (
    <HelpContentContext.Provider value={content}>
      {children}
    </HelpContentContext.Provider>
  );
}

function HelpSearch({ className }: { className?: string } = {}) {
  const content = useActiveHelpContent();
  const { ui } = content;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const results = useMemo(
    () => searchHelpArticles(content, query),
    [content, query],
  );
  const showResults = Boolean(query.trim());
  const activeResult = activeIndex >= 0 ? results[activeIndex] : undefined;
  const resultsHeightClass =
    results.length >= 5
      ? "h-80"
      : results.length === 4
        ? "h-72"
        : results.length === 3
          ? "h-56"
          : results.length === 2
            ? "h-40"
            : "h-24";

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    resultRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      className={cn(
        "relative mx-auto mt-7 w-full max-w-2xl text-left",
        className,
      )}
    >
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-activedescendant={
          activeResult
            ? `help-search-result-${activeResult.category}-${activeResult.id}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={showResults ? "help-search-results" : undefined}
        aria-expanded={showResults}
        aria-haspopup="listbox"
        aria-label={ui.searchLabel}
        autoComplete="off"
        className="h-12 rounded-xl bg-background pl-12 pr-24 text-base shadow-sm"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && showResults) {
            event.preventDefault();
            setQuery("");
            setActiveIndex(-1);
            return;
          }
          if (event.key === "ArrowDown" && results.length) {
            event.preventDefault();
            setActiveIndex((current) =>
              current < results.length - 1 ? current + 1 : 0,
            );
            return;
          }
          if (event.key === "ArrowUp" && results.length) {
            event.preventDefault();
            setActiveIndex((current) =>
              current > 0 ? current - 1 : results.length - 1,
            );
            return;
          }
          if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            resultRefs.current[activeIndex]?.click();
          }
        }}
        placeholder={ui.searchPlaceholder}
        ref={inputRef}
        role="combobox"
        type="search"
        value={query}
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border bg-muted px-2 py-1 font-mono text-[11px] text-foreground sm:block">
        ⌘ K
      </kbd>
      <p aria-live="polite" className="sr-only">
        {showResults
          ? formatMessage(ui.articlesFound, content.language, {
              count: results.length,
            })
          : ""}
      </p>
      {showResults ? (
        <ScrollArea
          aria-label={ui.searchResults}
          className={cn(
            "absolute inset-x-0 top-full z-40 mt-2 rounded-xl border bg-popover text-popover-foreground shadow-lg",
            resultsHeightClass,
          )}
          id="help-search-results"
          role="listbox"
        >
          <div className="p-2">
            {results.length ? (
              results.map((article, index) => {
                const category = findHelpCategory(content, article.category);
                const selected = index === activeIndex;
                return (
                  <Link
                    aria-selected={selected}
                    className={cn(
                      "flex items-start justify-between gap-4 rounded-lg px-3 py-3 hover:bg-accent",
                      selected && "bg-accent",
                    )}
                    id={`help-search-result-${article.category}-${article.id}`}
                    key={`${article.category}/${article.id}`}
                    onClick={() => {
                      setQuery("");
                      setActiveIndex(-1);
                    }}
                    onFocus={() => setActiveIndex(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    params={{ article: article.id, category: article.category }}
                    preload="intent"
                    ref={(element) => {
                      resultRefs.current[index] = element;
                    }}
                    role="option"
                    tabIndex={-1}
                    to="/help/$category/$article"
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {article.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {category ? category.title : ""}
                      </span>
                    </span>
                    <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {ui.noArticlesFound}
              </p>
            )}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
}

function HelpArticleFigure({ screenshot }: { screenshot: HelpScreenshot }) {
  const { ui } = useActiveHelpContent();
  const [open, setOpen] = useState(false);
  const zoom = useImageZoom(`${screenshot.src}:${open}`);

  return (
    <>
      <figure className="mt-8 overflow-hidden rounded-xl border bg-muted/20 shadow-sm">
        <button
          aria-label={ui.openScreenshot}
          className="block w-full bg-background text-left"
          type="button"
          onClick={() => setOpen(true)}
        >
          <img
            alt={screenshot.alt}
            className="block h-auto w-full object-cover object-top"
            decoding="async"
            draggable={false}
            height={screenshot.height}
            loading="lazy"
            src={screenshot.src}
            width={screenshot.width}
          />
        </button>
        <figcaption className="border-t bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">
            {ui.visualExample}
          </span>{" "}
          {screenshot.caption}
        </figcaption>
      </figure>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)]"
          showCloseButton
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{screenshot.alt}</DialogTitle>
            <DialogDescription>{screenshot.caption}</DialogDescription>
          </DialogHeader>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <ImageZoomStage
              alt={screenshot.alt}
              src={screenshot.src}
              stageRef={zoom.stageRef}
              transform={zoom.transform}
              onDoubleClick={() =>
                zoom.transform.scale <= 1 ? zoom.zoomBy(2) : zoom.resetZoom()
              }
              onPointerCancel={zoom.handlePointerUp}
              onPointerDown={zoom.handlePointerDown}
              onPointerMove={zoom.handlePointerMove}
              onPointerUp={zoom.handlePointerUp}
              onWheel={zoom.handleWheel}
            />
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
              <div className="pointer-events-auto">
                <ImageZoomControls
                  scale={zoom.transform.scale}
                  onReset={zoom.resetZoom}
                  onZoomBy={zoom.zoomBy}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function HelpNotFound({ article }: { article?: boolean }) {
  const content = useActiveHelpContent();
  const { ui } = content;
  return (
    <ServerShell activePage="help">
      <main
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-4 px-5 text-center"
        data-content-language={content.language}
      >
        <Badge variant="outline">404</Badge>
        <h1 className="text-2xl font-bold">
          {article ? ui.articleNotFound : ui.categoryNotFound}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {ui.notFoundDescription}
        </p>
        <Button
          render={
            <Link activeOptions={{ exact: true }} preload="intent" to="/help" />
          }
          variant="outline"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {ui.backToHelp}
        </Button>
      </main>
    </ServerShell>
  );
}

function CategorySidebar({
  activeArticle,
  activeCategory,
}: {
  activeArticle?: string;
  activeCategory: HelpCategoryId;
}) {
  const content = useActiveHelpContent();
  const { categories, ui } = content;
  return (
    <aside
      aria-label={ui.helpNavigation}
      className="hidden w-64 shrink-0 border-r pr-5 lg:block"
    >
      <nav className="sticky top-6 space-y-5">
        {categories.map((category) => {
          const selectedCategory = category.id === activeCategory;
          const Icon = categoryIcons[category.id];
          return (
            <div key={category.id}>
              <Link
                aria-current={
                  selectedCategory && !activeArticle ? "page" : undefined
                }
                activeOptions={{ exact: true }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                  selectedCategory && !activeArticle
                    ? "bg-primary/10 text-primary"
                    : selectedCategory
                      ? "text-primary hover:bg-muted"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                params={{ category: category.id }}
                preload="intent"
                to="/help/$category"
              >
                <Icon className="size-4" />
                {category.title}
              </Link>
              {selectedCategory ? (
                <div className="relative mt-1 space-y-0.5 pl-5">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-4 w-px bg-sidebar-border"
                  />
                  {articlesInCategory(content, category.id).map((article) => (
                    <Link
                      aria-current={
                        article.id === activeArticle ? "page" : undefined
                      }
                      activeOptions={{ exact: true }}
                      className={cn(
                        "block rounded-md px-3 py-1.5 text-sm",
                        article.id === activeArticle
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      key={article.id}
                      params={{ article: article.id, category: category.id }}
                      preload="intent"
                      to="/help/$category/$article"
                    >
                      {article.title}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileCategoryNav({
  activeCategory,
}: {
  activeCategory: HelpCategoryId;
}) {
  const { categories, ui } = useActiveHelpContent();
  return (
    <div className="-mx-5 mb-7 overflow-x-auto border-b px-5 pb-3 lg:hidden">
      <nav className="flex min-w-max gap-2" aria-label={ui.helpCategories}>
        {categories.map((category) => (
          <Button
            key={category.id}
            render={
              <Link
                activeOptions={{ exact: true }}
                params={{ category: category.id }}
                preload="intent"
                to="/help/$category"
              />
            }
            size="sm"
            variant={category.id === activeCategory ? "secondary" : "ghost"}
          >
            {category.title}
          </Button>
        ))}
      </nav>
    </div>
  );
}

function HelpHomePageContent() {
  const content = useActiveHelpContent();
  const { articles, categories, ui } = content;
  useDocumentMeta(ui.homeMetaTitle, ui.homeMetaDescription);

  const popularArticles = articles.filter((article) => article.popular);

  return (
    <ServerShell activePage="help">
      <ScrollArea className="min-h-0 flex-1">
        <main
          className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-12 sm:py-16"
          data-content-language={content.language}
        >
          <section className="mx-auto w-full max-w-4xl text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              {ui.homeHeading}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {ui.homeDescription}
            </p>
            <HelpSearch />
          </section>

          <section aria-labelledby="help-categories" className="mt-14">
            <h2 className="sr-only" id="help-categories">
              {ui.categories}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => {
                const Icon = categoryIcons[category.id];
                const articles = articlesInCategory(content, category.id);
                return (
                  <Card
                    className="transition-colors hover:border-primary/40"
                    key={category.id}
                  >
                    <CardHeader>
                      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </div>
                      <CardTitle>{category.title}</CardTitle>
                      <CardDescription className="leading-6">
                        {category.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        {articles.length} {ui.categoryArticles}
                      </span>
                      <Button
                        render={
                          <Link
                            params={{ category: category.id }}
                            preload="intent"
                            to="/help/$category"
                          />
                        }
                        size="sm"
                        variant="ghost"
                      >
                        {ui.explore}
                        <ArrowRightIcon data-icon="inline-end" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="popular-help" className="mt-14 w-full">
            <h2
              className="text-xl font-semibold tracking-tight"
              id="popular-help"
            >
              {ui.popularArticles}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {ui.popularDescription}
            </p>
            <div className="mt-5 divide-y border-y">
              {popularArticles.map((article) => (
                <Link
                  className="flex items-center justify-between gap-4 py-4 hover:text-primary"
                  key={article.id}
                  params={{ article: article.id, category: article.category }}
                  preload="intent"
                  to="/help/$category/$article"
                >
                  <span className="text-sm font-medium">{article.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <ClockIcon className="size-3.5" />
                    {article.readMinutes} {ui.minutes}
                    <ArrowRightIcon className="size-4" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <ServerFooter className="pt-12" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}

export function HelpHomePage() {
  return (
    <HelpContentBoundary>
      <HelpHomePageContent />
    </HelpContentBoundary>
  );
}

function HelpCategoryPageContent({ categoryId }: { categoryId: string }) {
  const content = useActiveHelpContent();
  const { ui } = content;
  const category = findHelpCategory(content, categoryId);
  useDocumentMeta(
    category
      ? `${category.title} — ${ui.pageTitleSuffix}`
      : ui.categoryNotFound,
    category ? category.description : ui.categoryNotFoundDescription,
  );
  if (!category) return <HelpNotFound />;
  const articles = articlesInCategory(content, category.id);
  const Icon = categoryIcons[category.id];

  return (
    <ServerShell activePage="help">
      <ScrollArea className="min-h-0 flex-1">
        <main
          className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-8"
          data-content-language={content.language}
        >
          <HelpSearch className="mb-12 mt-0" />
          <MobileCategoryNav activeCategory={category.id} />
          <div className="flex flex-1 gap-8">
            <CategorySidebar activeCategory={category.id} />
            <div className="min-w-0 flex-1">
              <header className="border-b pb-7">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <h1 className="mt-4 text-3xl font-bold tracking-tight">
                  {category.title}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
                  {category.description}
                </p>
              </header>
              <div className="divide-y">
                {articles.map((article) => (
                  <Link
                    className="group -mx-3 flex items-start justify-between gap-5 px-3 py-6 transition-colors hover:bg-muted"
                    key={article.id}
                    params={{ article: article.id, category: category.id }}
                    preload="intent"
                    to="/help/$category/$article"
                  >
                    <span>
                      <span className="block text-base font-semibold">
                        {article.title}
                      </span>
                      <span className="mt-1.5 block max-w-2xl text-sm leading-6 text-muted-foreground">
                        {article.summary}
                      </span>
                      <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ClockIcon className="size-3.5" />
                        {article.readMinutes} {ui.minutes}
                      </span>
                    </span>
                    <ArrowRightIcon className="mt-1 size-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <ServerFooter className="pt-12" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}

export function HelpCategoryPage({ categoryId }: { categoryId: string }) {
  return (
    <HelpContentBoundary>
      <HelpCategoryPageContent categoryId={categoryId} />
    </HelpContentBoundary>
  );
}

const helpProseLinkClassName =
  "font-medium text-primary underline underline-offset-4";

function HelpProse({
  children,
  inline = false,
}: {
  children: string;
  inline?: boolean;
}) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children, href }) =>
          href?.startsWith("/") ? (
            <Link className={helpProseLinkClassName} preload="intent" to={href}>
              {children}
            </Link>
          ) : (
            <a
              className={helpProseLinkClassName}
              href={href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {children}
            </a>
          ),
        code: ({ children }) => (
          <code className="rounded-md border bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
            {children}
          </code>
        ),
        p: inline
          ? ({ children }) => <span>{children}</span>
          : ({ children }) => <p>{children}</p>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function HelpArticlePageContent({
  articleId,
  categoryId,
}: {
  articleId: string;
  categoryId: string;
}) {
  const content = useActiveHelpContent();
  const { ui } = content;
  const category = findHelpCategory(content, categoryId);
  const article = findHelpArticle(content, categoryId, articleId);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  useDocumentMeta(
    article ? `${article.title} — ${ui.pageTitleSuffix}` : ui.articleNotFound,
    article ? article.summary : ui.articleNotFoundDescription,
  );

  useEffect(() => {
    if (!article) return;
    const sections = article.sections
      .map((_, index) => document.getElementById(`section-${index + 1}`))
      .filter((section): section is HTMLElement => Boolean(section));
    const viewport = sections[0]?.closest<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!viewport || !sections.length) return;
    const scrollViewport = viewport;

    function updateActiveSection() {
      const viewportBounds = scrollViewport.getBoundingClientRect();
      const activationLine =
        viewportBounds.top + Math.min(160, scrollViewport.clientHeight * 0.25);
      let nextIndex = 0;

      for (const [index, section] of sections.entries()) {
        if (section.getBoundingClientRect().top > activationLine) break;
        nextIndex = index;
      }
      if (
        scrollViewport.scrollHeight -
          scrollViewport.scrollTop -
          scrollViewport.clientHeight <=
        2
      ) {
        nextIndex = sections.length - 1;
      }
      setActiveSectionIndex(nextIndex);
    }

    updateActiveSection();
    scrollViewport.addEventListener("scroll", updateActiveSection, {
      passive: true,
    });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      scrollViewport.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [article]);

  if (!category || !article) return <HelpNotFound article />;

  return (
    <ServerShell activePage="help">
      <ScrollArea className="min-h-0 flex-1">
        <main
          className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-8"
          data-content-language={content.language}
        >
          <HelpSearch className="mb-12 mt-0" />
          <MobileCategoryNav activeCategory={category.id} />
          <div className="flex flex-1 gap-8">
            <CategorySidebar
              activeArticle={article.id}
              activeCategory={category.id}
            />
            <article className="min-w-0 flex-1">
              <nav
                aria-label={ui.breadcrumb}
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <Link
                  activeOptions={{ exact: true }}
                  className="hover:text-foreground"
                  preload="intent"
                  to="/help"
                >
                  {ui.help}
                </Link>
                <span>/</span>
                <Link
                  activeOptions={{ exact: true }}
                  className="hover:text-foreground"
                  params={{ category: category.id }}
                  preload="intent"
                  to="/help/$category"
                >
                  {category.title}
                </Link>
              </nav>
              <header className="mt-6 border-b pb-7">
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {article.title}
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
                  {article.summary}
                </p>
                <span className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ClockIcon className="size-3.5" />
                  {article.readMinutes} {ui.minutes}
                </span>
              </header>
              <HelpArticleFigure screenshot={article.screenshot} />
              <section
                aria-labelledby="article-guide"
                className="mt-8 border-y py-6"
              >
                <h2
                  className="text-sm font-semibold uppercase tracking-wide text-foreground"
                  id="article-guide"
                >
                  {ui.articleGuide}
                </h2>
                <ol className="mt-4 grid gap-3 sm:grid-cols-2">
                  {article.sections.map((section, sectionIndex) => (
                    <li key={`${article.id}-guide-${sectionIndex}`}>
                      <a
                        className="flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground"
                        href={`#section-${sectionIndex + 1}`}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {sectionIndex + 1}
                        </span>
                        <span>{section.heading}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
              <div className="py-2">
                {article.sections.map((section, sectionIndex) => (
                  <section
                    className="scroll-mt-6 border-b py-8 last:border-b-0"
                    id={`section-${sectionIndex + 1}`}
                    key={`${article.id}-section-${sectionIndex}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {sectionIndex + 1}
                      </span>
                      <h2 className="text-xl font-semibold tracking-tight">
                        {section.heading}
                      </h2>
                    </div>
                    <div className="mt-4 space-y-4 text-sm leading-7 text-muted-foreground">
                      {section.paragraphs.map((paragraph, paragraphIndex) => (
                        <HelpProse
                          key={`${article.id}-${sectionIndex}-paragraph-${paragraphIndex}`}
                        >
                          {paragraph}
                        </HelpProse>
                      ))}
                      {section.bullets?.length ? (
                        <ul className="space-y-2">
                          {section.bullets.map((bullet, bulletIndex) => (
                            <li
                              className="flex items-start gap-2"
                              key={`${article.id}-${sectionIndex}-bullet-${bulletIndex}`}
                            >
                              <CheckCircleIcon className="mt-1 size-4 shrink-0 text-primary" />
                              <HelpProse inline>{bullet}</HelpProse>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </section>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4">
                <span className="text-sm text-muted-foreground">
                  {ui.stillNeedContext}
                </span>
                <Button
                  render={
                    <Link
                      activeOptions={{ exact: true }}
                      params={{ category: category.id }}
                      preload="intent"
                      to="/help/$category"
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  {ui.seeAllCategory}
                </Button>
              </div>
            </article>
            <aside className="hidden w-48 shrink-0 xl:block">
              <nav
                aria-label={ui.onThisPage}
                className="sticky top-6 border-l pl-4"
              >
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground">
                  {ui.onThisPage}
                </p>
                <div className="space-y-2">
                  {article.sections.map((section, sectionIndex) => (
                    <a
                      aria-current={
                        activeSectionIndex === sectionIndex
                          ? "location"
                          : undefined
                      }
                      className={cn(
                        "-ml-[17px] block border-l-2 py-0.5 pl-4 text-xs leading-5 transition-colors",
                        activeSectionIndex === sectionIndex
                          ? "border-primary font-medium text-primary"
                          : "border-transparent text-muted-foreground hover:text-primary",
                      )}
                      href={`#section-${sectionIndex + 1}`}
                      key={`${article.id}-aside-${sectionIndex}`}
                    >
                      {section.heading}
                    </a>
                  ))}
                </div>
              </nav>
            </aside>
          </div>
          <ServerFooter className="pt-12" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}

export function HelpArticlePage({
  articleId,
  categoryId,
}: {
  articleId: string;
  categoryId: string;
}) {
  return (
    <HelpContentBoundary>
      <HelpArticlePageContent articleId={articleId} categoryId={categoryId} />
    </HelpContentBoundary>
  );
}
