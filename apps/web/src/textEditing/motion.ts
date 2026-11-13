const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

/** End of the next word: skips separators, then word characters. */
export function wordEndAfter(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && !isWordCharacter(text[index])) index += 1;
  while (index < text.length && isWordCharacter(text[index])) index += 1;
  return index;
}

/** Start of the previous word: skips separators, then word characters. */
export function wordStartBefore(text: string, offset: number): number {
  let index = offset;
  while (index > 0 && !isWordCharacter(text[index - 1])) index -= 1;
  while (index > 0 && isWordCharacter(text[index - 1])) index -= 1;
  return index;
}

/** Steps over a whole surrogate pair so the caret never splits an emoji. */
export function characterOffset(text: string, offset: number, direction: 1 | -1): number {
  if (direction === 1) {
    if (offset >= text.length) return text.length;
    const code = text.codePointAt(offset) ?? 0;
    return offset + (code > 0xffff ? 2 : 1);
  }
  if (offset <= 0) return 0;
  const low = text.charCodeAt(offset - 1);
  const high = text.charCodeAt(offset - 2);
  const pair = low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff;
  return offset - (pair ? 2 : 1);
}

export function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

export function lineEndOf(text: string, offset: number): number {
  const end = text.indexOf("\n", offset);
  return end === -1 ? text.length : end;
}

/**
 * The range a kill to the line end removes. When only whitespace is left on the
 * line, the line break goes too, so repeated kills join the following lines.
 */
export function lineEndKillRange(text: string, offset: number): readonly [number, number] {
  const end = lineEndOf(text, offset);
  const rest = text.slice(offset, end);
  if (rest.trim().length > 0) return [offset, end];
  return [offset, Math.min(end + 1, text.length)];
}

export function lineStartKillRange(text: string, offset: number): readonly [number, number] {
  const start = lineStartOf(text, offset);
  return start === offset ? [Math.max(start - 1, 0), offset] : [start, offset];
}

/**
 * The caret after moving one logical line, keeping `column` where the target
 * line is long enough. Null at the first or last line.
 */
export function verticalLineOffset(
  text: string,
  offset: number,
  direction: 1 | -1,
  column: number,
): number | null {
  const start = lineStartOf(text, offset);
  if (direction === -1) {
    if (start === 0) return null;
    const previousStart = lineStartOf(text, start - 1);
    return Math.min(previousStart + column, start - 1);
  }
  const end = lineEndOf(text, offset);
  if (end === text.length) return null;
  const nextStart = end + 1;
  return Math.min(nextStart + column, lineEndOf(text, nextStart));
}

/**
 * Swaps the characters around the caret and moves past them. At a line end the
 * two characters before the caret swap instead, as in Emacs and readline.
 */
export function transposeAt(
  text: string,
  offset: number,
): { readonly from: number; readonly to: number; readonly replacement: string } | null {
  const atLineEnd = offset === text.length || text[offset] === "\n";
  const from = atLineEnd ? offset - 2 : offset - 1;
  if (from < 0 || from + 2 > text.length) return null;
  const pair = text.slice(from, from + 2);
  if (pair.includes("\n")) return null;
  return { from, to: from + 2, replacement: `${pair[1]}${pair[0]}` };
}

export interface TextReplacement {
  readonly from: number;
  readonly to: number;
  readonly replacement: string;
}

/** Swaps the word before the caret with the one after it, as Emacs' transpose-words does. */
export function transposeWordsAt(text: string, offset: number): TextReplacement | null {
  const secondEnd = wordEndAfter(text, offset);
  const secondStart = wordStartBefore(text, secondEnd);
  let firstEnd = secondStart;
  while (firstEnd > 0 && !isWordCharacter(text[firstEnd - 1])) firstEnd -= 1;
  const firstStart = wordStartBefore(text, firstEnd);
  if (firstStart === firstEnd || secondStart === secondEnd || firstEnd > secondStart) return null;
  return {
    from: firstStart,
    to: secondEnd,
    replacement:
      text.slice(secondStart, secondEnd) +
      text.slice(firstEnd, secondStart) +
      text.slice(firstStart, firstEnd),
  };
}

export type WordCase = "upper" | "lower" | "capital";

/** Changes the case of the text from the caret to the end of the next word. */
export function caseWordAt(
  text: string,
  offset: number,
  wordCase: WordCase,
): TextReplacement | null {
  const to = wordEndAfter(text, offset);
  if (to === offset) return null;
  const source = text.slice(offset, to);
  let replacement = source.toLowerCase();
  if (wordCase === "upper") replacement = source.toUpperCase();
  if (wordCase === "capital") {
    const first = source.search(/[\p{L}\p{N}]/u);
    if (first !== -1) {
      replacement =
        replacement.slice(0, first) +
        source.charAt(first).toUpperCase() +
        replacement.slice(first + 1);
    }
  }
  return { from: offset, to, replacement };
}
