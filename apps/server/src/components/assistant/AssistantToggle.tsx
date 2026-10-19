import { useEffect, useState } from "react";
import { Button } from "@pinar/ui";
import { useServerI18n } from "@/lib/i18n";
import IconSparkles from "~icons/lucide/sparkles";
import { fetchAssistantStatus } from "./assistant-client";
import { useAssistantPanel } from "./assistant-panel-state";

/**
 * Header button that opens the assistant panel. It consults
 * `GET /api/assistant/status` once on mount and stays hidden (at a fixed
 * size, so the header never shifts) until the answer allows it:
 * `available: true`, `not_configured` or `requires_pro`. `disabled` and
 * error answers keep it hidden.
 */
export function AssistantToggle() {
  const { t } = useServerI18n();
  const { open, toggle } = useAssistantPanel();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAssistantStatus()
      .then((status) => {
        if (!alive) return;
        if (
          status !== null
          && (status.available
            || status.reason === "not_configured"
            || status.reason === "requires_pro")
        ) {
          setVisible(true);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Button
      aria-expanded={open}
      aria-label={t("assistant.toggle")}
      size="icon-sm"
      style={{ visibility: visible ? "visible" : "hidden" }}
      tabIndex={visible ? 0 : -1}
      title={t("assistant.toggle")}
      type="button"
      // Only the icon, also while the panel is open: the ghost variant would
      // fill the expanded state with bg-muted.
      className="aria-expanded:bg-transparent"
      variant="ghost"
      onClick={toggle}
    >
      <IconSparkles aria-hidden="true" className="size-4" />
    </Button>
  );
}
