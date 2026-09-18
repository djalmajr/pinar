export {};

declare global {
  var __pinarKeyboardEvents: {
    copyShortcutLabel(apple: boolean): string;
    handleComposerKeyDown(event: KeyboardEvent): boolean;
    isCopyShortcut(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">, apple: boolean): boolean;
    stopComposerKeyboardEvent(event: KeyboardEvent): void;
  };
}
