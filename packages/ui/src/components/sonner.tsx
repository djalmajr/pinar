import type { CSSProperties } from "react";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import IconCircleCheck from "~icons/lucide/circle-check";
import IconInfo from "~icons/lucide/info";
import IconLoaderCircle from "~icons/lucide/loader-circle";
import IconOctagonX from "~icons/lucide/octagon-x";
import IconTriangleAlert from "~icons/lucide/triangle-alert";

interface ToasterStyle extends CSSProperties {
  "--border-radius": string;
  "--normal-bg": string;
  "--normal-border": string;
  "--normal-text": string;
}

const toasterStyle: ToasterStyle = {
  "--border-radius": "var(--radius)",
  "--normal-bg": "var(--popover)",
  "--normal-border": "var(--border)",
  "--normal-text": "var(--popover-foreground)",
};

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      icons={{
        error: <IconOctagonX className="size-4" />,
        info: <IconInfo className="size-4" />,
        loading: <IconLoaderCircle className="size-4 animate-spin" />,
        success: <IconCircleCheck className="size-4" />,
        warning: <IconTriangleAlert className="size-4" />,
      }}
      style={toasterStyle}
      toastOptions={{ classNames: { toast: "cn-toast" } }}
      {...props}
    />
  );
}

export { Toaster, toast };
