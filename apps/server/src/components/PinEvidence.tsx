import { useState } from "react";
import { describeEvidenceItem, type EvidenceGrade, type PinEvidence as PinEvidenceValue } from "@pinar/shared";
import { Badge, Button, ToggleGroup, ToggleGroupItem } from "@pinar/ui";
import { useServerI18n } from "@/lib/i18n";
import Trash2Icon from "~icons/lucide/trash-2";

interface PinEvidenceProps {
  busy?: boolean;
  canEdit: boolean;
  evidence: PinEvidenceValue;
  onRemove: (index: number) => void;
}

type EvidenceFilter = EvidenceGrade | "all";

function environmentLine(evidence: PinEvidenceValue) {
  const environment = evidence.environment;
  if (!environment) return "";
  return [
    environment.browser,
    environment.platform,
    environment.viewport ? `${environment.viewport.width}×${environment.viewport.height}` : "",
    environment.devicePixelRatio ? `dpr ${environment.devicePixelRatio}` : "",
    environment.language,
    environment.theme,
    environment.online === false ? "offline" : "",
  ].filter(Boolean).join(" · ");
}

export function PinEvidence({ busy = false, canEdit, evidence, onRemove }: PinEvidenceProps) {
  const { t } = useServerI18n();
  const [filter, setFilter] = useState<EvidenceFilter>("all");
  const visible = evidence.items
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => filter === "all" || item.grade === filter);
  const environment = environmentLine(evidence);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("viewer.evidence")}</p>
          <p className="text-xs text-muted-foreground">{t("viewer.evidenceDescription")}</p>
        </div>
        <ToggleGroup
          aria-label={t("viewer.evidence")}
          size="sm"
          value={[filter]}
          variant="outline"
          onValueChange={(value) => {
            const next = value[0];
            if (next === "all" || next === "after_interaction" || next === "same_page") setFilter(next);
          }}
        >
          <ToggleGroupItem value="all">{t("viewer.evidenceAll")}</ToggleGroupItem>
          <ToggleGroupItem value="after_interaction">{t("viewer.evidenceAfterInteraction")}</ToggleGroupItem>
          <ToggleGroupItem value="same_page">{t("viewer.evidenceSamePage")}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("viewer.evidenceEmptyFilter")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map(({ index, item }) => (
            <li className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-xs" key={`${item.at}-${index}`}>
              <Badge className="mt-0.5 shrink-0" variant={item.grade === "after_interaction" ? "default" : "secondary"}>
                {item.grade === "after_interaction" ? t("viewer.evidenceAfterInteraction") : t("viewer.evidenceSamePage")}
              </Badge>
              <div className="min-w-0 flex-1 font-mono leading-relaxed [overflow-wrap:anywhere]">
                <div className="text-foreground">{describeEvidenceItem(item)}</div>
                <div className="text-muted-foreground">{item.at}{item.frame ? ` · ${item.frame}` : ""}</div>
                {item.stack ? <pre className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{item.stack}</pre> : null}
              </div>
              {canEdit ? (
                <Button
                  aria-label={t("viewer.evidenceRemove")}
                  className="shrink-0"
                  disabled={busy}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onClick={() => onRemove(index)}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {environment ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{t("viewer.evidenceEnvironment")}:</span> {environment}
        </p>
      ) : null}
    </div>
  );
}
