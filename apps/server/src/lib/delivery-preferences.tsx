import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_DELIVERY_PREFERENCES,
  parseDeliveryPreferences,
  type DeliveryPreferences,
} from "@pinar/shared";
import { useServerI18n } from "@/lib/i18n";

interface DeliveryPreferencesContextValue extends DeliveryPreferences {
  available: boolean;
  patch: (partial: Partial<DeliveryPreferences>) => Promise<void>;
}

const DeliveryPreferencesContext = createContext<DeliveryPreferencesContextValue | null>(null);

function preferencesFromBody(body: unknown): DeliveryPreferences | null {
  if (typeof body !== "object" || body === null) return null;
  return parseDeliveryPreferences(body);
}

export function DeliveryPreferencesProvider({ children }: { children: ReactNode }) {
  const { language, setLanguage } = useServerI18n();
  const languageRef = useRef(language);
  languageRef.current = language;
  const [preferences, setPreferences] = useState(DEFAULT_DELIVERY_PREFERENCES);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/preferences");
        const body: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        const next = preferencesFromBody(body);
        if (!response.ok || next == null) {
          setAvailable(false);
          return;
        }
        setPreferences(next);
        setAvailable(true);
        if (next.language != null && next.language !== languageRef.current) {
          setLanguage(next.language);
        }
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setLanguage]);

  const patch = useCallback(async (partial: Partial<DeliveryPreferences>) => {
    const previous = preferences;
    setPreferences((current) => ({ ...current, ...partial }));
    try {
      const response = await fetch("/api/preferences", {
        body: JSON.stringify(partial),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const body: unknown = await response.json().catch(() => null);
      const next = preferencesFromBody(body);
      if (!response.ok || next == null) {
        setPreferences(previous);
        return;
      }
      setPreferences(next);
    } catch {
      setPreferences(previous);
    }
  }, [preferences]);

  const value = useMemo(
    () => ({
      ...preferences,
      available,
      patch,
    }),
    [available, patch, preferences],
  );

  return (
    <DeliveryPreferencesContext.Provider value={value}>
      {children}
    </DeliveryPreferencesContext.Provider>
  );
}

export function useDeliveryPreferences() {
  const context = useContext(DeliveryPreferencesContext);
  if (!context) {
    throw new Error("useDeliveryPreferences must be used inside DeliveryPreferencesProvider");
  }
  return context;
}
