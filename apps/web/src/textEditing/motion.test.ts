import { describe, expect, it } from "vite-plus/test";

import {
  caseWordAt,
  characterOffset,
  lineEndKillRange,
  lineStartKillRange,
  transposeAt,
  transposeWordsAt,
  verticalLineOffset,
  wordEndAfter,
  wordStartBefore,
} from "./motion";

describe("word motion", () => {
  it.each([
    ["foo bar", 0, 3],
    ["foo bar", 3, 7],
    ["  --foo.bar", 0, 7],
    ["naïve café", 0, 5],
    ["end", 3, 3],
  ])("ends the word after %j at %i", (text, offset, expected) => {
    expect(wordEndAfter(text, offset)).toBe(expected);
  });

  it.each([
    ["foo bar", 7, 4],
    ["foo bar", 4, 0],
    ["foo.bar--  ", 11, 4],
    ["", 0, 0],
  ])("starts the word before %j at %i", (text, offset, expected) => {
    expect(wordStartBefore(text, offset)).toBe(expected);
  });
});

describe("characterOffset", () => {
  it("steps over a surrogate pair in both directions", () => {
    const text = "a😀b";
    expect(characterOffset(text, 1, 1)).toBe(3);
    expect(characterOffset(text, 3, -1)).toBe(1);
    expect(characterOffset(text, 4, 1)).toBe(4);
    expect(characterOffset(text, 0, -1)).toBe(0);
  });
});

describe("line cuts", () => {
  it.each([
    ["one\ntwo", 1, [1, 3]],
    ["one\ntwo", 3, [3, 4]],
    ["one  \ntwo", 3, [3, 6]],
    ["one", 3, [3, 3]],
  ] as const)("cuts to the line end of %j from %i", (text, offset, expected) => {
    expect(lineEndKillRange(text, offset)).toEqual(expected);
  });

  it.each([
    ["one\ntwo", 6, [4, 6]],
    ["one\ntwo", 4, [3, 4]],
    ["one", 0, [0, 0]],
  ] as const)("cuts to the line start of %j from %i", (text, offset, expected) => {
    expect(lineStartKillRange(text, offset)).toEqual(expected);
  });
});

describe("verticalLineOffset", () => {
  const text = "abcdef\nxy\nlonger line";

  it("keeps the goal column and clamps to short lines", () => {
    expect(verticalLineOffset(text, 4, 1, 4)).toBe(9);
    expect(verticalLineOffset(text, 9, 1, 4)).toBe(14);
    expect(verticalLineOffset(text, 14, -1, 4)).toBe(9);
    expect(verticalLineOffset(text, 9, -1, 4)).toBe(4);
  });

  it("stops at the first and last line", () => {
    expect(verticalLineOffset(text, 2, -1, 2)).toBeNull();
    expect(verticalLineOffset(text, 12, 1, 2)).toBeNull();
  });
});

describe("transposeAt", () => {
  it.each([
    ["abc", 1, { from: 0, to: 2, replacement: "ba" }],
    ["abc", 3, { from: 1, to: 3, replacement: "cb" }],
    ["ab\ncd", 2, { from: 0, to: 2, replacement: "ba" }],
    ["abc", 0, null],
    ["a\nb", 1, null],
  ] as const)("swaps around %j at %i", (text, offset, expected) => {
    expect(transposeAt(text, offset)).toEqual(expected);
  });
});

describe("transposeWordsAt", () => {
  it.each([
    ["foo bar", 4, { from: 0, to: 7, replacement: "bar foo" }],
    ["foo, bar baz", 3, { from: 0, to: 8, replacement: "bar, foo" }],
    ["foo bar", 7, { from: 0, to: 7, replacement: "bar foo" }],
    ["foo", 1, null],
    ["foo bar", 0, null],
  ] as const)("swaps the words around %j at %i", (text, offset, expected) => {
    expect(transposeWordsAt(text, offset)).toEqual(expected);
  });
});

describe("caseWordAt", () => {
  it.each([
    ["hello world", 0, "upper", { from: 0, to: 5, replacement: "HELLO" }],
    ["HeLLo world", 0, "lower", { from: 0, to: 5, replacement: "hello" }],
    ["hello wORLD", 5, "capital", { from: 5, to: 11, replacement: " World" }],
    ["héllo", 1, "upper", { from: 1, to: 5, replacement: "ÉLLO" }],
    ["hello", 5, "upper", null],
  ] as const)("changes %j at %i to %s case", (text, offset, wordCase, expected) => {
    expect(caseWordAt(text, offset, wordCase)).toEqual(expected);
  });
});
