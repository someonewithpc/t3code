import type { CutEntry, TextSurface } from "./surface";

type NativeField = HTMLInputElement | HTMLTextAreaElement;

function asNativeField(element: Element): NativeField | null {
  if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) return null;
  if (element.readOnly || element.disabled) return null;
  // email and number inputs have no selection API.
  return element.selectionStart === null ? null : element;
}

/**
 * Edits go through execCommand so they land on the field's undo stack and fire
 * the input events controlled React fields read their value from.
 */
function insertText(field: NativeField, from: number, to: number, text: string): void {
  field.setSelectionRange(from, to);
  if (text.length > 0) document.execCommand("insertText", false, text);
  else if (from !== to) document.execCommand("delete");
}

export function nativeFieldSurface(element: Element): TextSurface | null {
  const field = asNativeField(element);
  if (!field) return null;
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? start;
  const backward = field.selectionDirection === "backward";
  const text = field.value;
  const entryFor = (from: number, to: number): CutEntry => ({
    text: text.slice(from, to),
    data: new Map(),
  });
  return {
    element: field,
    text,
    multiline: field instanceof HTMLTextAreaElement,
    anchor: backward ? end : start,
    head: backward ? start : end,
    select(anchor, head) {
      field.setSelectionRange(
        Math.min(anchor, head),
        Math.max(anchor, head),
        head < anchor ? "backward" : "forward",
      );
    },
    replace(from, to, replacement) {
      insertText(field, from, to, replacement);
    },
    cut(from, to) {
      const entry = entryFor(from, to);
      insertText(field, from, to, "");
      return entry;
    },
    copy: entryFor,
    paste(entry) {
      const from = field.selectionStart ?? 0;
      insertText(field, from, field.selectionEnd ?? from, entry.text);
      return from + entry.text.length;
    },
    moveVertically: () => false,
    newline() {
      if (!(field instanceof HTMLTextAreaElement)) return;
      insertText(field, start, end, "\n");
    },
    undo() {
      document.execCommand("undo");
    },
  };
}
