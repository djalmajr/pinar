import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_DELIVERY_PREFERENCES, type DeliveryPreferences, type HandoffMode } from "@pinar/shared";

interface DeliveryPreferencesContextValue {
  available: boolean;
  handoffMode: HandoffMode;
  includeScreenshot: boolean;
  setHandoffMode: (value: HandoffMode) => Promise<void>;
  setIncludeScreenshot: (value: boolean) => Promise<void>;
}

const DeliveryPreferencesContext = createContext<DeliveryPreferencesContextValue | null>(null);

function preferencesFromBody(body: unknown): DeliveryPreferences | null {
  if (typeof body !== "object" || body === null || !("includeScreenshot" in body)) return null;
  const record = body as { handoffMode?: unknown; includeScreenshot?: unknown };
  return {
    handoffMode: record.handoffMode === "full" ? "full" : "compact",
    includeScreenshot: record.includeScreenshot !== false,
  };
}

export function DeliveryPreferencesProvider({ children }: { children: ReactNode }) {
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
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchPreferences = useCallback(async (patch: Partial<DeliveryPreferences>) => {
    const previous = preferences;
    setPreferences((current) => ({ ...current, ...patch }));
    try {
      const response = await fetch("/api/preferences", {
        body: JSON.stringify(patch),
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

  const setHandoffMode = useCallback(
    (value: HandoffMode) => patchPreferences({ handoffMode: value }),
    [patchPreferences],
  );
  const setIncludeScreenshot = useCallback(
    (value: boolean) => patchPreferences({ includeScreenshot: value }),
    [patchPreferences],
  );

  const value = useMemo(
    () => ({
      available,
      handoffMode: preferences.handoffMode,
      includeScreenshot: preferences.includeScreenshot,
      setHandoffMode,
      setIncludeScreenshot,
    }),
    [available, preferences, setHandoffMode, setIncludeScreenshot],
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
