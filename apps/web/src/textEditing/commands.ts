import type { TextEditingKeybindingCommand } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindingMatching";

import { isTerminalFocused } from "../lib/terminalFocus";
import { registerCommands, type CommandHandlers } from "../shortcuts/dispatcher";
import { CutRing } from "./cutRing";
import { mapOffsetThroughEdit } from "./mark";
import {
  characterOffset,
  lineEndKillRange,
  lineEndOf,
  lineStartKillRange,
  lineStartOf,
  caseWordAt,
  transposeAt,
  transposeWordsAt,
  type TextReplacement,
  type WordCase,
  verticalLineOffset,
  wordEndAfter,
  wordStartBefore,
} from "./motion";
import { nativeFieldSurface } from "./nativeFieldSurface";
import { proseMirrorSurface } from "./proseMirrorSurface";
import type { TextSurface } from "./surface";

type LastAction =
  | { readonly kind: "cut"; readonly element: Element }
  | {
      readonly kind: "paste";
      readonly element: Element;
      readonly from: number;
      readonly to: number;
      readonly depth: number;
    }
  | { readonly kind: "vertical"; readonly element: Element; readonly column: number };

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"]);

const ring = new CutRing();
const selectionAnchored = new WeakSet<Element>();
/** The mark outlives the active selection, as in Emacs; `text` is the field when it was set. */
const marks = new WeakMap<Element, { readonly offset: number; readonly text: string }>();
let lastAction: LastAction | null = null;
/** What the command before the running one left behind; each command starts with `lastAction` cleared. */
let previousAction: LastAction | null = null;
let handledEvent: Event | null = null;

function focusedElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

function surfaceFor(element: Element): TextSurface | null {
  return nativeFieldSurface(element) ?? proseMirrorSurface(element);
}

/** Fields that drive a list (palette search, pickers, the composer's suggestions) take Up/Down for it. */
function drivesList(element: Element): boolean {
  return (
    element.getAttribute("role") === "combobox" ||
    element.hasAttribute("aria-activedescendant") ||
    element.getAttribute("aria-expanded") === "true" ||
    element instanceof HTMLInputElement
  );
}

function replayArrow(element: Element, direction: 1 | -1): void {
  const key = direction === 1 ? "ArrowDown" : "ArrowUp";
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
  );
}

function setMark(surface: TextSurface, offset: number): void {
  marks.set(surface.element, { offset, text: surface.text });
}

function markOf(surface: TextSurface): number | null {
  const mark = marks.get(surface.element);
  if (!mark) return null;
  return Math.min(mapOffsetThroughEdit(mark.text, surface.text, mark.offset), surface.text.length);
}

function moveTo(surface: TextSurface, head: number): void {
  const anchored = selectionAnchored.has(surface.element);
  surface.select(anchored ? surface.anchor : head, head);
}

function cut(surface: TextSurface, from: number, to: number, join: "before" | "after"): void {
  const joinWithLast =
    previousAction?.kind === "cut" && previousAction.element === surface.element ? join : null;
  selectionAnchored.delete(surface.element);
  if (from !== to) ring.add(surface.cut(from, to), joinWithLast);
  lastAction = { kind: "cut", element: surface.element };
}

function moveVertically(surface: TextSurface, direction: 1 | -1): void {
  if (!surface.multiline || drivesList(surface.element)) {
    replayArrow(surface.element, direction);
    return;
  }
  if (surface.moveVertically(direction, selectionAnchored.has(surface.element))) return;
  const { text, head, element } = surface;
  const column =
    previousAction?.kind === "vertical" && previousAction.element === element
      ? previousAction.column
      : head - lineStartOf(text, head);
  const target = verticalLineOffset(text, head, direction, column);
  if (target !== null) moveTo(surface, target);
  lastAction = { kind: "vertical", element, column };
}

function selectionRange(surface: TextSurface): readonly [number, number] {
  return [Math.min(surface.anchor, surface.head), Math.max(surface.anchor, surface.head)];
}

function paste(surface: TextSurface, depth: number): void {
  const entry = ring.at(depth);
  if (!entry) return;
  selectionAnchored.delete(surface.element);
  const [from] = selectionRange(surface);
  setMark(surface, from);
  const to = surface.paste(entry);
  lastAction = { kind: "paste", element: surface.element, from, to, depth };
}

/** Like Delete and Backspace, removes the selection when there is one. */
function deleteCharacter(surface: TextSurface, direction: 1 | -1): void {
  selectionAnchored.delete(surface.element);
  const [from, to] = selectionRange(surface);
  if (from !== to) surface.replace(from, to, "");
  else if (direction === 1) surface.replace(to, characterOffset(surface.text, to, 1), "");
  else surface.replace(characterOffset(surface.text, from, -1), from, "");
}

function applyReplacement(surface: TextSurface, edit: TextReplacement | null): void {
  if (!edit) return;
  selectionAnchored.delete(surface.element);
  surface.replace(edit.from, edit.to, edit.replacement);
  surface.select(edit.from + edit.replacement.length, edit.from + edit.replacement.length);
}

function caseWord(surface: TextSurface, wordCase: WordCase): void {
  applyReplacement(surface, caseWordAt(surface.text, surface.head, wordCase));
}

type TextCommand = (surface: TextSurface) => void;

const TEXT_COMMANDS: Record<TextEditingKeybindingCommand, TextCommand> = {
  "text.cursorForward": (s) => moveTo(s, characterOffset(s.text, s.head, 1)),
  "text.cursorBackward": (s) => moveTo(s, characterOffset(s.text, s.head, -1)),
  "text.cursorWordForward": (s) => moveTo(s, wordEndAfter(s.text, s.head)),
  "text.cursorWordBackward": (s) => moveTo(s, wordStartBefore(s.text, s.head)),
  "text.cursorLineStart": (s) => moveTo(s, lineStartOf(s.text, s.head)),
  "text.cursorLineEnd": (s) => moveTo(s, lineEndOf(s.text, s.head)),
  "text.cursorLineDown": (s) => moveVertically(s, 1),
  "text.cursorLineUp": (s) => moveVertically(s, -1),
  "text.cursorDocumentStart": (s) => {
    if (!selectionAnchored.has(s.element)) setMark(s, s.head);
    moveTo(s, 0);
  },
  "text.cursorDocumentEnd": (s) => {
    if (!selectionAnchored.has(s.element)) setMark(s, s.head);
    moveTo(s, s.text.length);
  },
  "text.deleteForward": (s) => deleteCharacter(s, 1),
  "text.deleteBackward": (s) => deleteCharacter(s, -1),
  "text.cutWordForward": (s) => cut(s, s.head, wordEndAfter(s.text, s.head), "after"),
  "text.cutWordBackward": (s) => cut(s, wordStartBefore(s.text, s.head), s.head, "before"),
  "text.cutToLineEnd": (s) => {
    const [from, to] = lineEndKillRange(s.text, s.head);
    cut(s, from, to, "after");
  },
  "text.cutToLineStart": (s) => {
    const [from, to] = lineStartKillRange(s.text, s.head);
    cut(s, from, to, "before");
  },
  "text.cutSelection": (s) => {
    const [from, to] = selectionRange(s);
    if (from === to) cut(s, wordStartBefore(s.text, s.head), s.head, "before");
    else cut(s, from, to, "before");
  },
  "text.copySelection": (s) => {
    const [from, to] = selectionRange(s);
    selectionAnchored.delete(s.element);
    if (from !== to) ring.add(s.copy(from, to), null);
  },
  "text.paste": (s) => paste(s, 0),
  "text.pasteOlder": (s) => {
    if (previousAction?.kind !== "paste" || previousAction.element !== s.element) return;
    const { from, to, depth } = previousAction;
    s.select(from, to);
    paste(surfaceFor(s.element) ?? s, depth + 1);
  },
  "text.transposeCharacters": (s) => {
    const swap = transposeAt(s.text, s.head);
    if (swap) s.replace(swap.from, swap.to, swap.replacement);
  },
  "text.anchorSelection": (s) => {
    if (selectionAnchored.has(s.element) && s.anchor === s.head) {
      selectionAnchored.delete(s.element);
      return;
    }
    selectionAnchored.add(s.element);
    setMark(s, s.head);
    s.select(s.head, s.head);
  },
  "text.selectAll": (s) => {
    selectionAnchored.add(s.element);
    setMark(s, s.text.length);
    s.select(s.text.length, 0);
  },
  "text.exchangePointAndMark": (s) => {
    const active = selectionAnchored.has(s.element) || s.anchor !== s.head;
    const mark = active ? s.anchor : markOf(s);
    if (mark === null) return;
    setMark(s, s.head);
    selectionAnchored.add(s.element);
    s.select(s.head, mark);
  },
  "text.clearSelection": (s) => {
    selectionAnchored.delete(s.element);
    s.select(s.head, s.head);
  },
  "text.transposeWords": (s) => applyReplacement(s, transposeWordsAt(s.text, s.head)),
  "text.upcaseWord": (s) => caseWord(s, "upper"),
  "text.downcaseWord": (s) => caseWord(s, "lower"),
  "text.capitalizeWord": (s) => caseWord(s, "capital"),
  "text.newline": (s) => {
    if (!s.multiline) return;
    selectionAnchored.delete(s.element);
    s.newline();
  },
  "text.undo": (s) => s.undo(),
};

function isKeybindingCaptureTarget(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element && event.target.closest("[data-keybinding-capture]") !== null
  );
}

/**
 * Text editing commands act on the focused text field or rich-text editor.
 * They run in the capture phase so the editor's own keymap never sees the key,
 * and fall through when nothing editable that they understand has focus.
 */
function runCommand(command: TextEditingKeybindingCommand, event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  const element = focusedElement();
  const surface = element ? surfaceFor(element) : null;
  if (!surface) return false;
  event.preventDefault();
  event.stopPropagation();
  handledEvent = event;
  previousAction = lastAction;
  lastAction = null;
  TEXT_COMMANDS[command](surface);
  return true;
}

/** While the selection is anchored, the plain motion keys extend it, as they do in Emacs. */
const ANCHORED_MOTION_KEYS: Readonly<Record<string, TextEditingKeybindingCommand>> = {
  ArrowLeft: "text.cursorBackward",
  ArrowRight: "text.cursorForward",
  ArrowUp: "text.cursorLineUp",
  ArrowDown: "text.cursorLineDown",
  Home: "text.cursorLineStart",
  End: "text.cursorLineEnd",
  "alt+ArrowLeft": "text.cursorWordBackward",
  "alt+ArrowRight": "text.cursorWordForward",
};

/** The platform's own word, line and document motions. */
const PLATFORM_MOTION_KEYS: Readonly<Record<string, TextEditingKeybindingCommand>> = {
  "ctrl+ArrowLeft": "text.cursorWordBackward",
  "ctrl+ArrowRight": "text.cursorWordForward",
  "ctrl+Home": "text.cursorDocumentStart",
  "ctrl+End": "text.cursorDocumentEnd",
};

const MAC_MOTION_KEYS: Readonly<Record<string, TextEditingKeybindingCommand>> = {
  "meta+ArrowLeft": "text.cursorLineStart",
  "meta+ArrowRight": "text.cursorLineEnd",
  "meta+ArrowUp": "text.cursorDocumentStart",
  "meta+ArrowDown": "text.cursorDocumentEnd",
};

function anchoredMotionFor(event: KeyboardEvent): TextEditingKeybindingCommand | undefined {
  if (event.shiftKey) return undefined;
  const modifiers = [event.ctrlKey && "ctrl", event.altKey && "alt", event.metaKey && "meta"];
  const key = [...modifiers.filter(Boolean), event.key].join("+");
  const platformKeys = isMacPlatform(navigator.platform) ? MAC_MOTION_KEYS : PLATFORM_MOTION_KEYS;
  return ANCHORED_MOTION_KEYS[key] ?? platformKeys[key];
}

function extendAnchoredSelection(event: KeyboardEvent): void {
  // Synthetic arrows are the ones moveVertically replays for lists.
  if (!event.isTrusted || event.defaultPrevented) return;
  const command = anchoredMotionFor(event);
  const element = focusedElement();
  if (!command || !element || !selectionAnchored.has(element)) return;
  if (isKeybindingCaptureTarget(event) || isTerminalFocused()) return;
  runCommand(command, event);
}

export function installTextEditingCommands(): () => void {
  const handlers: CommandHandlers = {};
  for (const command of Object.keys(TEXT_COMMANDS) as TextEditingKeybindingCommand[]) {
    handlers[command] = (event) => runCommand(command, event);
  }
  const dispose = registerCommands(handlers, {
    capture: true,
    when: (event) => !isKeybindingCaptureTarget(event) && !isTerminalFocused(),
  });

  // registerCommands installed the dispatcher's window listener first, so this runs after it.
  const forgetOnKey = (event: KeyboardEvent) => {
    if (!MODIFIER_KEYS.has(event.key) && handledEvent !== event) lastAction = null;
  };
  const forget = () => {
    lastAction = null;
  };
  const dropAnchor = (event: Event) => {
    if (event.target instanceof Element) selectionAnchored.delete(event.target);
  };
  const dropAllAnchors = () => {
    const element = focusedElement();
    if (element) selectionAnchored.delete(element);
    lastAction = null;
  };
  window.addEventListener("keydown", extendAnchoredSelection, true);
  window.addEventListener("keydown", forgetOnKey, true);
  window.addEventListener("pointerdown", dropAllAnchors, true);
  window.addEventListener("input", dropAnchor, true);
  window.addEventListener("focusout", dropAnchor, true);
  window.addEventListener("blur", forget);
  return () => {
    dispose();
    window.removeEventListener("keydown", extendAnchoredSelection, true);
    window.removeEventListener("keydown", forgetOnKey, true);
    window.removeEventListener("pointerdown", dropAllAnchors, true);
    window.removeEventListener("input", dropAnchor, true);
    window.removeEventListener("focusout", dropAnchor, true);
    window.removeEventListener("blur", forget);
  };
}
