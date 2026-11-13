import { describe, expect, it } from "vite-plus/test";

import { mapOffsetThroughEdit } from "./mark";

describe("mapOffsetThroughEdit", () => {
  it.each([
    ["unchanged", "foo bar", "foo bar", 4, 4],
    ["typing after the mark", "foo bar", "foo barbaz", 4, 4],
    ["typing before the mark", "foo bar", "xxfoo bar", 4, 6],
    ["deleting before the mark", "foo bar", "o bar", 4, 2],
    ["deleting around the mark", "aaa XYZ bbb", "aaa bbb", 5, 4],
    ["replacing a span with the mark at its end", "foo bar", "foo qux", 7, 7],
    ["clearing the field", "foo bar", "", 4, 0],
    ["the mark at the start", "foo", "xfoo", 0, 0],
  ])("handles %s", (_name, before, after, offset, expected) => {
    expect(mapOffsetThroughEdit(before, after, offset)).toBe(expected);
  });
});
