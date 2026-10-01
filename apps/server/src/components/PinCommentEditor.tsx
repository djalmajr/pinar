import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Button } from "../../../../packages/ui/src/components/button.tsx";
import type { Translate } from "@/lib/i18n";
import { commentEditorExtensions } from "./pin-comment-editor";

export interface PinCommentEditorProps {
  /** Markdown draft of the current pin (the viewer's existing draft state). */
  draft: string;
  /**
   * Stable per pin. Changing it re-creates the editor from the new draft,
   * which is how the reset syncs after a successful send and on pin switch.
   */
  editorKey: string;
  /** Accessible label for the editor (t("viewer.commentLabel")). */
  label: string;
  /** True while the comment is being sent. */
  disabled?: boolean;
  t: Translate;
  /** onUpdate: markdown of the current content, for the existing draft state. */
  onChange: (markdown: string) => void;
}

// Basic formatting controls only. The toolbar shows Lucide icons; the
// localized label stays the accessible name via aria-label/title, and
// aria-pressed exposes the toggle state.
const EDITOR_CONTROLS: {
  icon: string;
  isActive: (editor: Editor) => boolean;
  key: "viewer.editorBlockquote" | "viewer.editorBold" | "viewer.editorBulletList" | "viewer.editorCode" | "viewer.editorItalic" | "viewer.editorOrderedList";
  toggle: (editor: Editor) => void;
}[] = [
  {
    icon: "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",
    key: "viewer.editorBold",
    isActive: (editor) => editor.isActive("bold"),
    toggle: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    icon: "M19 4h-9m4 16H5M15 4L9 20",
    key: "viewer.editorItalic",
    isActive: (editor) => editor.isActive("italic"),
    toggle: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    icon: "M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13",
    key: "viewer.editorBulletList",
    isActive: (editor) => editor.isActive("bulletList"),
    toggle: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    icon: "M11 5h10m-10 7h10m-10 7h10M4 4h1v5M4 9h2m.5 11H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02",
    key: "viewer.editorOrderedList",
    isActive: (editor) => editor.isActive("orderedList"),
    toggle: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    icon: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1a6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zM5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1a6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
    key: "viewer.editorBlockquote",
    isActive: (editor) => editor.isActive("blockquote"),
    toggle: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    icon: "m16 18l6-6l-6-6M8 6l-6 6l6 6",
    key: "viewer.editorCode",
    isActive: (editor) => editor.isActive("code"),
    toggle: (editor) => editor.chain().focus().toggleCode().run(),
  },
];

// Lucide paths verified against the local @iconify-json/lucide catalog; the
// SVG is inlined because the Vite-only `~icons` transform is not available
// under Bun SSR. Size comes from the Button icon contract (size-4 = 16px).
function EditorControlIcon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d={d} />
    </svg>
  );
}

export function PinCommentEditor({
  draft,
  editorKey,
  label,
  disabled = false,
  t,
  onChange,
}: PinCommentEditorProps) {
  // `deps` is the editor identity: the editor is (re)created only when the
  // pin changes, never on each keystroke, so typing keeps the selection and
  // the caret. The markdown draft is the initial content (contentType
  // markdown); onUpdate pushes markdown back into the existing draft state.
  const editor = useEditor(
    {
      content: draft,
      contentType: "markdown",
      // The contenteditable itself carries the accessible role, name, and
      // the multiline attribute: no <label> may wrap the editor, because a
      // wrapping label forwards its click to the first labelable descendant
      // — the Bold button of the toolbar. The role is set explicitly here:
      // the browser proved the core's base role does not reach the element.
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
        },
      },
      extensions: commentEditorExtensions(),
      immediatelyRender: false,
      onUpdate: ({ editor }) => {
        onChange(editor.getMarkdown());
      },
    },
    [editorKey],
  );

  // `useEditor` does not re-render on transactions by default, so a cursor
  // move or a stored-mark toggle (pressing Bold on an empty editor) would
  // leave the aria-pressed states stale: the markdown draft only changes on
  // doc updates. Re-render only when one of the six states actually changes.
  const activeStates = useEditorState({
    editor,
    selector: (snapshot) => {
      const current = snapshot.editor;
      return current
        ? EDITOR_CONTROLS.map((control) => control.isActive(current))
        : null;
    },
  });

  // Sending disables the editor in place; the draft stays until the send
  // outcome decides (success clears it, failure keeps it).
  useEffect(() => {
    // Skip only when the editable state already matches the desired one
    // (!disabled): the previous guard compared against `disabled`, which
    // skipped exactly the transitions that were needed (busy kept the field
    // contenteditable and un-busy never re-enabled it).
    if (!editor || editor.isEditable === !disabled) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-input bg-background">
      <div
        aria-label={t("viewer.editorFormatting")}
        className="flex flex-wrap items-center gap-1 border-b border-input bg-muted/40 p-1.5"
        role="toolbar"
      >
        {EDITOR_CONTROLS.map((control, index) => (
          <Button
            aria-label={t(control.key)}
            aria-pressed={activeStates ? activeStates[index] : false}
            // The Button's secondary variant ships no aria-pressed rule; the
            // active state stays visually distinct from hover/focus with the
            // local tokens.
            className="aria-pressed:bg-primary/15 aria-pressed:text-primary"
            disabled={disabled || !editor}
            key={control.key}
            size="icon-sm"
            title={t(control.key)}
            type="button"
            variant="secondary"
            // Prevent the button from stealing focus/selection when pressed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (editor && !disabled) control.toggle(editor);
            }}
          >
            <EditorControlIcon d={control.icon} />
          </Button>
        ))}
      </div>
      <EditorContent
        // Tailwind preflight strips list markers and blockquote borders;
        // the presentation is applied only inside this editor's subtree.
        className="min-h-20 w-full outline-none focus-within:ring-2 focus-within:ring-ring [&_.tiptap]:min-h-16 [&_.tiptap]:px-3 [&_.tiptap]:py-2 [&_.tiptap]:text-sm [&_.tiptap]:outline-none [&_.tiptap_blockquote]:my-2 [&_.tiptap_blockquote]:border-l-4 [&_.tiptap_blockquote]:pl-3 [&_.tiptap_code]:rounded [&_.tiptap_code]:border [&_.tiptap_code]:bg-muted [&_.tiptap_code]:px-1 [&_.tiptap_code]:font-mono [&_.tiptap_ol]:my-2 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_ul]:my-2 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5"
        editor={editor}
      />
    </div>
  );
}
