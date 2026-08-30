import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_DELIVERY_PREFERENCES } from "@pinar/shared";

interface DeliveryPreferencesContextValue {
  available: boolean;
  includeScreenshot: boolean;
  setIncludeScreenshot: (value: boolean) => Promise<void>;
}

const DeliveryPreferencesContext = createContext<DeliveryPreferencesContextValue | null>(null);

function includeScreenshotFromBody(body: unknown) {
  return typeof body === "object" && body !== null && "includeScreenshot" in body
    ? (body as { includeScreenshot?: unknown }).includeScreenshot !== false
    : null;
}

export function DeliveryPreferencesProvider({ children }: { children: ReactNode }) {
  const [includeScreenshot, setIncludeScreenshotState] = useState(
    DEFAULT_DELIVERY_PREFERENCES.includeScreenshot,
  );
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/preferences");
        const body: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        const next = includeScreenshotFromBody(body);
        if (!response.ok || next == null) {
          setAvailable(false);
          return;
        }
        setIncludeScreenshotState(next);
        setAvailable(true);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setIncludeScreenshot = useCallback(async (value: boolean) => {
    const previous = includeScreenshot;
    setIncludeScreenshotState(value);
    try {
      const response = await fetch("/api/preferences", {
        body: JSON.stringify({ includeScreenshot: value }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const body: unknown = await response.json().catch(() => null);
      const next = includeScreenshotFromBody(body);
      if (!response.ok || next == null) {
        setIncludeScreenshotState(previous);
        return;
      }
      setIncludeScreenshotState(next);
    } catch {
      setIncludeScreenshotState(previous);
    }
  }, [includeScreenshot]);

  const value = useMemo(
    () => ({ available, includeScreenshot, setIncludeScreenshot }),
    [available, includeScreenshot, setIncludeScreenshot],
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
