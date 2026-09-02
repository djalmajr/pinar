import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { translations, type SupportedLanguage } from "@pinar/shared";
import type { UiMessages } from "./ui-locales/en";
import {
  isSupportedLanguage,
  LANGUAGE_STORAGE_KEY,
  persistLanguage,
  readLanguageCookie,
} from "./language";

export type { UiMessages };
export type ServerMessageKey = keyof UiMessages;
export type MessageValues = Record<string, string | number>;
export type Translate = (key: ServerMessageKey, values?: MessageValues) => string;

type UiMessagesModule = { default: UiMessages };

const uiMessageLoaders = {
  en: () => import("./ui-locales/en"),
  pt: () => import("./ui-locales/pt"),
  es: () => import("./ui-locales/es"),
  fr: () => import("./ui-locales/fr"),
  de: () => import("./ui-locales/de"),
  zh: () => import("./ui-locales/zh"),
  ja: () => import("./ui-locales/ja"),
} satisfies Record<SupportedLanguage, () => Promise<UiMessagesModule>>;

const uiMessagePromises = new Map<SupportedLanguage, Promise<UiMessages>>();
const uiMessages = new Map<SupportedLanguage, UiMessages>();

export function loadUiMessages(language: SupportedLanguage) {
  const cached = uiMessagePromises.get(language);
  if (cached) return cached;
  const promise = uiMessageLoaders[language]().then((module) => {
    uiMessages.set(language, module.default);
    return module.default;
  });
  uiMessagePromises.set(language, promise);
  return promise;
}

const pluralRules = new Map<SupportedLanguage, Intl.PluralRules>();
const numberFormats = new Map<SupportedLanguage, Intl.NumberFormat>();

function pluralRulesFor(language: SupportedLanguage) {
  const cached = pluralRules.get(language);
  if (cached) return cached;
  const rules = new Intl.PluralRules(language);
  pluralRules.set(language, rules);
  return rules;
}

function numberFormatFor(language: SupportedLanguage) {
  const cached = numberFormats.get(language);
  if (cached) return cached;
  const format = new Intl.NumberFormat(language);
  numberFormats.set(language, format);
  return format;
}

const PLURAL_BLOCK = /\{(\w+),\s*plural,\s*((?:[^{}]|\{[^{}]*\})*)\}/g;
const PLURAL_BRANCH = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;

function selectPluralBranch(body: string, exact: string, category: string) {
  const branches = new Map<string, string>();
  for (const branch of body.matchAll(PLURAL_BRANCH))
    branches.set(branch[1], branch[2]);
  return branches.get(exact) ?? branches.get(category) ?? branches.get("other");
}

export function formatMessage(
  template: string,
  language: SupportedLanguage,
  values?: MessageValues,
) {
  if (!values) return template;
  const expanded = template.replace(PLURAL_BLOCK, (block, name, body) => {
    const count = Number(values[name]);
    if (!Number.isFinite(count)) return block;
    const branch = selectPluralBranch(
      body,
      `=${count}`,
      pluralRulesFor(language).select(count),
    );
    if (branch === undefined) return block;
    return branch.replaceAll("#", numberFormatFor(language).format(count));
  });
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    expanded,
  );
}

interface ServerI18nValue {
  language: SupportedLanguage;
  languageName: (language: SupportedLanguage) => string;
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: ServerMessageKey, values?: MessageValues) => string;
}

const ServerI18nContext = createContext<ServerI18nValue | null>(null);

export function ServerI18nProvider({
  children,
  initialLanguage,
  initialMessages,
}: {
  children: ReactNode;
  initialLanguage: SupportedLanguage;
  initialMessages: UiMessages;
}) {
  const [active, setActive] = useState({
    language: initialLanguage,
    messages: initialMessages,
  });
  const activeLanguage = active.language;
  const migrated = useRef(false);

  const setLanguage = useCallback((next: SupportedLanguage) => {
    const cached = uiMessages.get(next);
    if (cached) {
      persistLanguage(next);
      setActive({ language: next, messages: cached });
      return;
    }
    void loadUiMessages(next).then((messages) => {
      persistLanguage(next);
      setActive({ language: next, messages });
    });
  }, []);

  useEffect(() => {
    uiMessages.set(initialLanguage, initialMessages);
    uiMessagePromises.set(initialLanguage, Promise.resolve(initialMessages));
  }, [initialLanguage, initialMessages]);

  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    const cookie = readLanguageCookie(document.cookie);
    if (!cookie) {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isSupportedLanguage(stored) && stored !== activeLanguage) {
        setLanguage(stored);
        return;
      }
    }
    if (cookie !== activeLanguage) persistLanguage(activeLanguage);
  }, [activeLanguage, setLanguage]);

  const value = useMemo<ServerI18nValue>(
    () => ({
      language: active.language,
      languageName: (candidate) => translations[candidate].name,
      setLanguage,
      t: (key, values) =>
        formatMessage(active.messages[key], active.language, values),
    }),
    [active, setLanguage],
  );

  return (
    <ServerI18nContext.Provider value={value}>
      {children}
    </ServerI18nContext.Provider>
  );
}

export function useServerI18n() {
  const context = useContext(ServerI18nContext);
  if (!context)
    throw new Error("useServerI18n must be used inside ServerI18nProvider");
  return context;
}
