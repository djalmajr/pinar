export {};

declare global {
  var __pinarKeyboardEvents: {
    copyShortcutLabel(apple: boolean): string;
    handleComposerKeyDown(event: KeyboardEvent): boolean;
    insertSuppressedKey(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "isComposing" | "key" | "metaKey">, field: {
      disabled?: boolean;
      dispatchEvent?: (event: Event) => boolean;
      maxLength?: number;
      readOnly?: boolean;
      selectionEnd?: number;
      selectionStart?: number;
      setRangeText: (replacedText: string, start: number, end: number, selectionMode?: "end" | "preserve" | "select") => void;
      value?: string;
    }): boolean;
    isCopyShortcut(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">, apple: boolean): boolean;
    pinarTextField(event: KeyboardEvent, host: HTMLElement, shadow?: ShadowRoot): HTMLElement | null;
    stopComposerKeyboardEvent(event: KeyboardEvent): void;
  };
}
