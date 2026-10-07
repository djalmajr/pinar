import type { SVGProps } from "react";
import type { ProjectIcon } from "@pinar/shared";
import {
  DEFAULT_PROJECT_ICON,
  PROJECT_ICON_HEIGHT,
  PROJECT_ICON_WIDTH,
  getProjectIconData,
} from "@pinar/shared/project-icons";

interface ProjectIconGlyphProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  icon: ProjectIcon;
}

export function ProjectIconGlyph({ icon, ...props }: ProjectIconGlyphProps) {
  const data = getProjectIconData(icon) ?? getProjectIconData(DEFAULT_PROJECT_ICON);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${data?.width ?? PROJECT_ICON_WIDTH} ${data?.height ?? PROJECT_ICON_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
      dangerouslySetInnerHTML={{ __html: data?.body ?? "" }}
    />
  );
}
