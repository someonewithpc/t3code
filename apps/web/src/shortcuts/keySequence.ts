import { shortcutKeyFromEvent } from "@t3tools/shared/keybindings";

import { toastManager } from "../components/ui/toast";
import {
  formatKeybindingStepsLabel,
  isKeySequenceCommandEvent,
  keySequenceCommandEvent,
  type KeySequenceMatch,
  type ShortcutEventLike,
} from "../keybindings";

export type KeySequenceResolver = (
  keys: ReadonlyArray<ShortcutEventLike>,
  event: KeyboardEvent,
) => KeySequenceMatch | null;

const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift", "OS"]);
const INDICATOR_TOAST_ID = "key-sequence";
const UNDEFINED_TOAST_TIMEOUT_MS = 2000;

let pendingKeys: ReadonlyArray<ShortcutEventLike> = [];

function snapshotKey(event: KeyboardEvent): ShortcutEventLike {
  const altGraph = event.getModifierState("AltGraph");
  return {
    key: event.key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    getModifierState: (key) => key === "AltGraph" && altGraph,
  };
}

function keysLabel(keys: ReadonlyArray<ShortcutEventLike>): string {
  return formatKeybindingStepsLabel(
    keys.map((key) => ({
      key: shortcutKeyFromEvent(key),
      metaKey: key.metaKey,
      ctrlKey: key.ctrlKey,
      shiftKey: key.shiftKey,
      altKey: key.altKey,
      modKey: false,
    })),
  );
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function isKeybindingCaptureTarget(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element && event.target.closest("[data-keybinding-capture]") !== null
  );
}

export function cancelKeySequence(): void {
  if (pendingKeys.length === 0) return;
  pendingKeys = [];
  toastManager.close(INDICATOR_TOAST_ID);
}

/**
 * Runs ahead of every other keydown listener. Consumes the keys of a sequence and, once one
 * completes, dispatches its command as a fresh keydown at the same target. Returns whether it
 * consumed the event.
 */
export function handleKeySequenceKeyDown(
  event: KeyboardEvent,
  resolve: KeySequenceResolver,
): boolean {
  if (event.isComposing || isKeySequenceCommandEvent(event)) return false;
  if (MODIFIER_KEYS.has(event.key)) return false;

  if (pendingKeys.length === 0) {
    if (event.repeat || isKeybindingCaptureTarget(event)) return false;
    if (resolve([event], event)?.type !== "prefix") return false;
    consume(event);
    pendingKeys = [snapshotKey(event)];
    toastManager.add({ id: INDICATOR_TOAST_ID, title: `${keysLabel(pendingKeys)}-`, timeout: 0 });
    return true;
  }

  consume(event);
  if (event.repeat) return true;
  if (event.key === "Escape") {
    cancelKeySequence();
    return true;
  }
  const keys = [...pendingKeys, snapshotKey(event)];
  const match = resolve([...pendingKeys, event], event);
  if (match?.type === "prefix") {
    pendingKeys = keys;
    toastManager.add({ id: INDICATOR_TOAST_ID, title: `${keysLabel(keys)}-`, timeout: 0 });
    return true;
  }
  pendingKeys = [];
  if (!match) {
    toastManager.add({
      id: INDICATOR_TOAST_ID,
      title: `${keysLabel(keys)} is undefined`,
      timeout: UNDEFINED_TOAST_TIMEOUT_MS,
    });
    return true;
  }
  toastManager.close(INDICATOR_TOAST_ID);
  (event.target ?? window).dispatchEvent(keySequenceCommandEvent(match.binding));
  return true;
}
