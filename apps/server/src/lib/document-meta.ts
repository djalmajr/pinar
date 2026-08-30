import { useEffect } from "react";

export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    if (!description) {
      return () => {
        document.title = previousTitle;
      };
    }
    const existing = document.querySelector("meta[name=\"description\"]");
    const created = !existing;
    const meta = existing ?? document.createElement("meta");
    if (created) {
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const previousDescription = created ? null : meta.getAttribute("content");
    meta.setAttribute("content", description);
    return () => {
      document.title = previousTitle;
      if (created) meta.remove();
      else if (previousDescription == null) meta.removeAttribute("content");
      else meta.setAttribute("content", previousDescription);
    };
  }, [description, title]);
}
