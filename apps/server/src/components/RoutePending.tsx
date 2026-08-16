import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerI18n } from "@/lib/i18n";

const SHOW_AFTER_MS = 100;

export function RoutePending() {
  const { t } = useServerI18n();
  const isLoading = useRouterState({
    select: (state) => state.status === "pending" || state.isLoading,
  });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setVisible(false);
      return;
    }

    const timeout = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timeout);
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      aria-label={t("common.loading")}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
      role="progressbar"
    >
      <div className="route-pending-bar h-full w-1/3 bg-primary" />
      <style>{`
        @keyframes route-pending-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .route-pending-bar {
          animation: route-pending-slide 1.1s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
