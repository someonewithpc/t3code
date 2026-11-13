import type { CutEntry } from "./surface";

const MAX_ENTRIES = 60;

/**
 * Text cut by the text editing commands, newest first. Cuts made back to back
 * in one field join into one entry, so repeated line cuts paste as one block.
 */
export class CutRing {
  private entries: CutEntry[] = [];

  add(entry: CutEntry, joinWithLast: "before" | "after" | null): void {
    if (entry.text.length === 0) return;
    const last = this.entries[0];
    if (joinWithLast && last) {
      // Rich formats describe only one piece, so a joined entry keeps plain text.
      const text = joinWithLast === "after" ? last.text + entry.text : entry.text + last.text;
      this.entries[0] = { text, data: new Map() };
      return;
    }
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
  }

  /** The entry `depth` steps back from the newest, wrapping around. */
  at(depth: number): CutEntry | null {
    if (this.entries.length === 0) return null;
    return this.entries[depth % this.entries.length] ?? null;
  }
}
