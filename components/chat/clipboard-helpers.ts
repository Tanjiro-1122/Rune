export function buildPastedTextValue(options: {
  currentValue: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  pastedText: string;
}) {
  const selectionStart = options.selectionStart ?? options.currentValue.length;
  const selectionEnd = options.selectionEnd ?? options.currentValue.length;
  return {
    nextValue: `${options.currentValue.slice(0, selectionStart)}${options.pastedText}${options.currentValue.slice(selectionEnd)}`,
    cursor: selectionStart + options.pastedText.length,
  };
}

export function getClipboardImageItems(items: DataTransferItemList | DataTransferItem[] | null | undefined) {
  return Array.from(items ?? []).filter((item) => item.type.startsWith("image/"));
}

export function getClipboardPlainText(clipboardData: DataTransfer | null | undefined) {
  return clipboardData?.getData("text/plain") ?? "";
}


export function applyPastedTextToTextarea(options: {
  textarea: HTMLTextAreaElement;
  currentValue: string;
  pastedText: string;
  setValue: (value: string) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
}) {
  const { nextValue, cursor } = buildPastedTextValue({
    currentValue: options.currentValue,
    selectionStart: options.textarea.selectionStart,
    selectionEnd: options.textarea.selectionEnd,
    pastedText: options.pastedText,
  });
  options.setValue(nextValue);
  const requestFrame = options.requestFrame ?? window.requestAnimationFrame;
  requestFrame(() => {
    options.textarea.focus();
    options.textarea.setSelectionRange(cursor, cursor);
  });
}
