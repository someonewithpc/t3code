/** Text removed by a cut, with any richer clipboard formats the editor wrote. */
export interface CutEntry {
  readonly text: string;
  readonly data: ReadonlyMap<string, string>;
}

/**
 * One focused editor seen as a flat string. Offsets count UTF-16 units of
 * `text`; editors with blocks or inline nodes map them to their own positions.
 */
export interface TextSurface {
  readonly element: HTMLElement;
  readonly text: string;
  readonly multiline: boolean;
  readonly anchor: number;
  readonly head: number;
  select(anchor: number, head: number): void;
  replace(from: number, to: number, text: string): void;
  /** Removes the range through the editor's own cut handling and returns what it put on the clipboard. */
  cut(from: number, to: number): CutEntry;
  copy(from: number, to: number): CutEntry;
  /** Inserts at the selection through the editor's paste handling; returns the caret after it. */
  paste(entry: CutEntry): number;
  /** Moves by one visual line when the editor can; returns false when it cannot. */
  moveVertically(direction: 1 | -1, extend: boolean): boolean;
  /** Inserts a line break the way the editor's own Shift+Enter does. */
  newline(): void;
  undo(): void;
}

export function createClipboardEvent(
  type: "copy" | "cut" | "paste",
  entry?: CutEntry,
): ClipboardEvent {
  const clipboardData = new DataTransfer();
  if (entry) {
    clipboardData.setData("text/plain", entry.text);
    for (const [format, value] of entry.data) clipboardData.setData(format, value);
  }
  return new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true });
}

export function readCutEntry(clipboardData: DataTransfer | null, fallback: string): CutEntry {
  const data = new Map<string, string>();
  let text = fallback;
  for (const format of clipboardData?.types ?? []) {
    if (format === "Files") continue;
    const value = clipboardData?.getData(format) ?? "";
    if (format === "text/plain") text = value;
    else data.set(format, value);
  }
  return { text, data };
}
