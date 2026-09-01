import type { SupportedLanguage } from "@pinar/shared";
import { useEffect, useState } from "react";

const resolvedContent = new Map<string, unknown>();

export function seedLocalizedContent<T>(
  namespace: string,
  language: SupportedLanguage,
  content: T,
) {
  resolvedContent.set(`${namespace}:${language}`, content);
}

export function useLocalizedContent<T>(
  namespace: string,
  language: SupportedLanguage,
  loader: (language: SupportedLanguage) => Promise<T>,
  defaultContent: T,
) {
  const cacheKey = `${namespace}:${language}`;
  const [state, setState] = useState<{ cacheKey: string; content: T }>(() => {
    const cached = resolvedContent.get(cacheKey) as T | undefined;
    return { cacheKey, content: cached ?? defaultContent };
  });

  useEffect(() => {
    const cached = resolvedContent.get(cacheKey) as T | undefined;
    if (cached) {
      setState({ cacheKey, content: cached });
      return;
    }
    let active = true;
    void loader(language).then((content) => {
      resolvedContent.set(cacheKey, content);
      if (active) setState({ cacheKey, content });
    });
    return () => {
      active = false;
    };
  }, [cacheKey, language, loader]);

  const cached = resolvedContent.get(cacheKey) as T | undefined;
  return (
    cached ?? (state.cacheKey === cacheKey ? state.content : defaultContent)
  );
}
