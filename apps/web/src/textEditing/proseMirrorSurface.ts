import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { createClipboardEvent, readCutEntry, type TextSurface } from "./surface";

interface FlatBlock {
  readonly start: number;
  readonly pos: number;
  readonly size: number;
}

interface FlatDocument {
  readonly text: string;
  readonly blocks: ReadonlyArray<FlatBlock>;
}

const OBJECT_REPLACEMENT = "￼";

/**
 * Joins the document's textblocks with "\n", one character per inline leaf
 * (chips, hard breaks), so a flat offset maps to a single document position.
 * Null when inline content would not map one to one.
 */
export function flattenDocument(doc: ProseMirrorNode): FlatDocument | null {
  let text = "";
  const blocks: FlatBlock[] = [];
  let mappable = true;
  doc.descendants((node, pos) => {
    if (!mappable) return false;
    if (!node.isTextblock) return true;
    if (blocks.length > 0) text += "\n";
    const size = node.content.size;
    const content = node.textBetween(0, size, undefined, (leaf) =>
      leaf.type.name === "hardBreak" ? "\n" : OBJECT_REPLACEMENT,
    );
    if (content.length !== size) mappable = false;
    blocks.push({ start: text.length, pos: pos + 1, size });
    text += content;
    return false;
  });
  return mappable && blocks.length > 0 ? { text, blocks } : null;
}

export function flatToPosition(flat: FlatDocument, offset: number): number {
  let block = flat.blocks[0]!;
  for (const candidate of flat.blocks) {
    if (candidate.start > offset) break;
    block = candidate;
  }
  return block.pos + Math.min(Math.max(offset - block.start, 0), block.size);
}

export function positionToFlat(flat: FlatDocument, position: number): number {
  let block = flat.blocks[0]!;
  for (const candidate of flat.blocks) {
    if (candidate.pos > position) break;
    block = candidate;
  }
  return block.start + Math.min(Math.max(position - block.pos, 0), block.size);
}

function tiptapEditorFor(element: Element): Editor | null {
  const editor = element.closest<HTMLElement & { editor?: Editor }>(".ProseMirror")?.editor;
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

export function proseMirrorSurface(element: Element): TextSurface | null {
  const editor = tiptapEditorFor(element);
  if (!editor) return null;
  const view: EditorView = editor.view;
  const flat = flattenDocument(view.state.doc);
  if (!flat) return null;
  const toPosition = (offset: number) => flatToPosition(flat, offset);
  const select = (anchor: number, head: number) => {
    const selection = TextSelection.create(view.state.doc, toPosition(anchor), toPosition(head));
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  };
  const runClipboardEvent = (type: "copy" | "cut", from: number, to: number) => {
    select(from, to);
    const event = createClipboardEvent(type);
    view.dom.dispatchEvent(event);
    return { event, entry: readCutEntry(event.clipboardData, flat.text.slice(from, to)) };
  };
  const { anchor, head } = view.state.selection;
  return {
    element: view.dom,
    text: flat.text,
    multiline: true,
    anchor: positionToFlat(flat, anchor),
    head: positionToFlat(flat, head),
    select,
    replace(from, to, text) {
      const tr = view.state.tr;
      if (text.length > 0) tr.insertText(text, toPosition(from), toPosition(to));
      else tr.delete(toPosition(from), toPosition(to));
      view.dispatch(tr.scrollIntoView());
    },
    cut(from, to) {
      const { event, entry } = runClipboardEvent("cut", from, to);
      if (!event.defaultPrevented) {
        view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
      }
      return entry;
    },
    copy(from, to) {
      const { entry } = runClipboardEvent("copy", from, to);
      select(to, to);
      return entry;
    },
    paste(entry) {
      const event = createClipboardEvent("paste", entry);
      view.dom.dispatchEvent(event);
      if (!event.defaultPrevented) {
        view.dispatch(view.state.tr.insertText(entry.text).scrollIntoView());
      }
      const after = flattenDocument(view.state.doc);
      return after ? positionToFlat(after, view.state.selection.head) : 0;
    },
    moveVertically(direction, extend) {
      const selection = window.getSelection();
      if (
        !selection?.anchorNode ||
        !view.dom.contains(selection.anchorNode) ||
        typeof selection.modify !== "function"
      ) {
        return false;
      }
      selection.modify(
        extend ? "extend" : "move",
        direction === 1 ? "forward" : "backward",
        "line",
      );
      if (!selection.anchorNode || !selection.focusNode) return false;
      const next = TextSelection.create(
        view.state.doc,
        view.posAtDOM(selection.anchorNode, selection.anchorOffset),
        view.posAtDOM(selection.focusNode, selection.focusOffset),
      );
      view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
      return true;
    },
    // The composer's Enter handling owns lists, quotes and shown Markdown; Shift+Enter never sends.
    newline() {
      view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    // The browser's own undo would rewrite the editor's DOM behind its back.
    undo() {
      editor.commands.undo();
    },
  };
}
