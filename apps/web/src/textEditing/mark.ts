/**
 * Where `offset` in `before` lands in `after`, treating everything between
 * their common prefix and common suffix as one edit. An offset inside the
 * edited span moves to its start, as an Emacs marker does when its text is
 * deleted.
 */
export function mapOffsetThroughEdit(before: string, after: string, offset: number): number {
  if (before === after) return offset;
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  if (offset <= prefix) return offset;
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (offset >= before.length - suffix) return offset + after.length - before.length;
  return prefix;
}
