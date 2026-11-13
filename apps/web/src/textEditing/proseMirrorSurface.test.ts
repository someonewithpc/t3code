import { getSchema, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vite-plus/test";

import { flatToPosition, flattenDocument, positionToFlat } from "./proseMirrorSurface";

const Chip = Node.create({
  name: "chip",
  group: "inline",
  inline: true,
  atom: true,
  renderHTML: () => ["span"],
});

const schema = getSchema([StarterKit, Chip]);

describe("flattenDocument", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "ab" }, { type: "chip" }, { type: "text", text: "c" }],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "x" },
                  { type: "hardBreak" },
                  { type: "text", text: "y" },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  it("joins textblocks with newlines and gives each inline leaf one character", () => {
    expect(flattenDocument(doc)?.text).toBe("ab￼c\nx\ny");
  });

  it("maps every flat offset to a position and back", () => {
    const flat = flattenDocument(doc)!;
    for (let offset = 0; offset <= flat.text.length; offset += 1) {
      expect(positionToFlat(flat, flatToPosition(flat, offset))).toBe(offset);
    }
    // The list adds two node boundaries before its paragraph's text.
    expect(flatToPosition(flat, 5)).toBe(doc.child(0).nodeSize + 3);
  });
});
