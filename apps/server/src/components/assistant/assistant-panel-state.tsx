import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const ASSISTANT_PANEL_OPEN_KEY = "pinar.assistant.open";

export interface AssistantPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const AssistantPanelContext = createContext<AssistantPanelState | null>(null);

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(ASSISTANT_PANEL_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredOpen(open: boolean) {
  try {
    localStorage.setItem(ASSISTANT_PANEL_OPEN_KEY, open ? "true" : "false");
  } catch {
    /* private mode */
  }
}

// Closed outside the provider: a stable no-op state so consumers never throw
// and never flip a panel they do not own.
const CLOSED_PANEL: AssistantPanelState = {
  open: false,
  setOpen: () => undefined,
  toggle: () => undefined,
};

export function AssistantPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);

  // Starts closed on the server; the stored preference wins once on the
  // client (the first paint must not depend on localStorage).
  useEffect(() => {
    setOpenState(readStoredOpen());
  }, []);

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    writeStoredOpen(value);
  }, []);

  const toggle = useCallback(() => {
    setOpenState((current) => {
      const next = !current;
      writeStoredOpen(next);
      return next;
    });
  }, []);

  const value = useMemo<AssistantPanelState>(() => ({ open, setOpen, toggle }), [open, setOpen, toggle]);

  return (
    <AssistantPanelContext.Provider value={value}>
      {children}
    </AssistantPanelContext.Provider>
  );
}

export function useAssistantPanel(): AssistantPanelState {
  return useContext(AssistantPanelContext) ?? CLOSED_PANEL;
}
