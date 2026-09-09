import { useState } from "react";
import type { ElementSnapshot, SnapshotNode } from "@pinar/shared";
import { useServerI18n } from "@/lib/i18n";
import ChevronDownIcon from "~icons/lucide/chevron-down";
import ChevronRightIcon from "~icons/lucide/chevron-right";
import TriangleAlertIcon from "~icons/lucide/triangle-alert";

interface PinStructureProps {
  snapshot?: ElementSnapshot;
}

interface StructureNodeProps {
  depth: number;
  node: SnapshotNode;
}

const SHOWN_ATTRIBUTES = ["id", "class", "role", "type", "href", "src", "aria-label"];

function attributeSummary(node: SnapshotNode) {
  if (!node.attrs) return "";
  return SHOWN_ATTRIBUTES
    .filter((name) => node.attrs?.[name])
    .map((name) => `${name}="${(node.attrs?.[name] ?? "").slice(0, 60)}"`)
    .join(" ");
}

function StructureNode({ depth, node }: StructureNodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const children = node.children ?? [];
  const styles = node.styles ? Object.entries(node.styles) : [];
  const attributes = attributeSummary(node);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-start gap-1">
        {children.length > 0 || styles.length > 0 ? (
          <button
            aria-expanded={open}
            className="mt-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground"
            type="button"
            onClick={() => setOpen((value) => !value)}
          >
            <Chevron className="size-3.5" />
          </button>
        ) : (
          <span className="mt-0.5 inline-block size-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
          <span className="text-foreground">&lt;{node.tag}{attributes ? ` ${attributes}` : ""}&gt;</span>
          {node.text ? <span className="ml-1 text-muted-foreground">"{node.text.slice(0, 80)}"</span> : null}
          {node.truncated ? <span className="ml-1 text-muted-foreground">…</span> : null}
        </div>
      </div>
      {open && styles.length > 0 ? (
        <div className="ml-5 rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {styles.map(([property, value]) => (
            <div key={property}>
              <span className="text-foreground/80">{property}</span>: {value};
            </div>
          ))}
        </div>
      ) : null}
      {open && children.length > 0 ? (
        <ul className="ml-4 flex flex-col gap-1 border-l pl-2">
          {children.map((child, index) => <StructureNode depth={depth + 1} key={`${child.tag}-${index}`} node={child} />)}
        </ul>
      ) : null}
    </li>
  );
}

export function PinStructure({ snapshot }: PinStructureProps) {
  const { t } = useServerI18n();
  if (!snapshot) {
    return <p className="p-5 text-sm text-muted-foreground">{t("viewer.structureEmpty")}</p>;
  }
  return (
    <div className="flex flex-col gap-4 p-5 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t("viewer.structureNodes", { count: snapshot.nodeCount })}</span>
        {snapshot.fonts.length > 0 ? (
          <span>
            {t("viewer.structureFonts")}: {snapshot.fonts.map((font) => [font.family, font.weight, font.style].filter(Boolean).join(" ")).join(", ")}
          </span>
        ) : null}
        {snapshot.icons.length > 0 ? (
          <span>
            {t("viewer.structureIcons")}: {snapshot.icons.map((icon) => icon.name).join(", ")}
          </span>
        ) : null}
      </div>
      {snapshot.truncated ? (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          {t("viewer.structureTruncated")}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        <StructureNode depth={0} node={snapshot.root} />
      </ul>
      {snapshot.context?.parent || snapshot.context?.siblings?.length ? (
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">{t("viewer.structureContext")}</p>
          <ul className="flex flex-col gap-1">
            {snapshot.context.parent ? <StructureNode depth={1} node={snapshot.context.parent} /> : null}
            {(snapshot.context.siblings ?? []).map((sibling, index) => (
              <StructureNode depth={1} key={`sibling-${index}`} node={sibling} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
