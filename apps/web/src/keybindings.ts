import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  type ResolvedKeybindingsConfig,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ModelPickerJumpKeybindingCommand,
  type ThreadJumpKeybindingCommand,
} from "@t3tools/contracts";
import {
  isMacPlatform,
  keybindingRuleSteps,
  matchesKeybindingShortcut,
  matchesKeybindingShortcutModifiers,
  normalizeEventKey,
  resolveEventKeys,
  type ShortcutEventLike as SharedShortcutEventLike,
  type ShortcutModifierStateLike,
} from "@t3tools/shared/keybindings";
import { isElectron } from "./env";
import { isEditableFocused } from "./lib/editableFocus";
import { projectScriptIdFromCommand } from "./projectScripts";

export type { ShortcutModifierStateLike } from "@t3tools/shared/keybindings";
export { shortcutKeyFromEvent } from "@t3tools/shared/keybindings";

export interface ShortcutEventLike extends SharedShortcutEventLike {
  target?: EventTarget | null;
  /** Set on React keyboard events. */
  nativeEvent?: object;
}

export type KeySequenceMatch =
  | { readonly type: "prefix" }
  | { readonly type: "command"; readonly binding: ResolvedKeybindingRule };

export interface ShortcutMatchContext {
  terminalFocus: boolean;
  terminalOpen: boolean;
  previewFocus: boolean;
  previewOpen: boolean;
  isWeb: boolean;
  isDesktop: boolean;
  editableFocus?: boolean;
  [key: string]: boolean;
}

interface ShortcutMatchOptions {
  platform?: string;
  context?: Partial<ShortcutMatchContext>;
}

interface ResolvedShortcutLabelOptions extends ShortcutMatchOptions {
  platform?: string;
}

const TERMINAL_WORD_BACKWARD = "\u001bb";
const TERMINAL_WORD_FORWARD = "\u001bf";
const TERMINAL_LINE_START = "\u0001";
const TERMINAL_LINE_END = "\u0005";
const TERMINAL_DELETE_TO_LINE_START = "\u0015";
function resolvePlatform(options: ShortcutMatchOptions | undefined): string {
  return options?.platform ?? navigator.platform;
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext {
  return {
    terminalFocus: false,
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
    editableFocus: false,
    ...options?.context,
  };
}

function evaluateWhenNode(node: KeybindingWhenNode, context: ShortcutMatchContext): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return Boolean(context[node.name]);
    case "not":
      return !evaluateWhenNode(node.node, context);
    case "and":
      return evaluateWhenNode(node.left, context) && evaluateWhenNode(node.right, context);
    case "or":
      return evaluateWhenNode(node.left, context) || evaluateWhenNode(node.right, context);
  }
}

function matchesWhenClause(
  whenAst: KeybindingWhenNode | undefined,
  context: ShortcutMatchContext,
): boolean {
  if (!whenAst) return true;
  return evaluateWhenNode(whenAst, context);
}

export function shortcutConflictKey(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): string {
  const useMetaForMod = isMacPlatform(platform);
  const metaKey = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const ctrlKey = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  return [
    shortcut.key,
    metaKey ? "meta" : "",
    ctrlKey ? "ctrl" : "",
    shortcut.shiftKey ? "shift" : "",
    shortcut.altKey ? "alt" : "",
  ].join("|");
}

function keybindingStepsConflictKey(
  steps: ReadonlyArray<KeybindingShortcut>,
  platform = navigator.platform,
): string {
  return steps.map((shortcut) => shortcutConflictKey(shortcut, platform)).join(" ");
}

function stepsForContext(
  binding: ResolvedKeybindingRule,
  context: ShortcutMatchContext,
): ReadonlyArray<KeybindingShortcut> {
  return "shortcut" in binding ? [shortcutForContext(binding, context)] : binding.sequence;
}

function shortcutForContext(
  binding: Extract<ResolvedKeybindingRule, { shortcut: KeybindingShortcut }>,
  context: ShortcutMatchContext,
) {
  const shortcut = binding.shortcut;
  // Resolve persisted Mod+Enter against send preference without rewriting saved shortcuts.
  if (
    context.composerRequiresModifier &&
    (binding.command === "composer.sendAlternate" ||
      binding.command === "composer.sendBackground") &&
    shortcut.key === "enter" &&
    shortcut.modKey &&
    !shortcut.metaKey &&
    !shortcut.ctrlKey &&
    !shortcut.altKey &&
    !shortcut.shiftKey
  ) {
    return { ...shortcut, shiftKey: true };
  }
  return shortcut;
}

/** The steps of each binding that would run the command; a single chord is one step. */
function effectiveKeybindingsForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): ReadonlyArray<KeybindingShortcut>[] {
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  const active: Array<{ binding: ResolvedKeybindingRule; conflictKey: string }> = [];
  // A prefix key shadows any shorter binding on the same keys, whatever the rule order.
  const prefixKeys = new Set<string>();
  for (const binding of keybindings) {
    if (!matchesWhenClause(binding.whenAst, context)) continue;
    const steps = stepsForContext(binding, context);
    for (let length = 1; length < steps.length; length += 1) {
      prefixKeys.add(keybindingStepsConflictKey(steps.slice(0, length), platform));
    }
    active.push({ binding, conflictKey: keybindingStepsConflictKey(steps, platform) });
  }

  const claimedKeys = new Set<string>(prefixKeys);
  const effective: ReadonlyArray<KeybindingShortcut>[] = [];
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const entry = active[index];
    if (!entry || claimedKeys.has(entry.conflictKey)) continue;
    claimedKeys.add(entry.conflictKey);
    if (entry.binding.command === command) {
      effective.push(stepsForContext(entry.binding, context));
    }
  }

  return effective;
}

/** Single-chord bindings only, for consumers that cannot follow a key sequence. */
export function effectiveShortcutsForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut[] {
  return effectiveKeybindingsForCommand(keybindings, command, options).flatMap((steps) =>
    steps.length === 1 && steps[0] ? [steps[0]] : [],
  );
}

function findEffectiveShortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut | null {
  return effectiveShortcutsForCommand(keybindings, command, options)[0] ?? null;
}

function matchesCommandShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): boolean {
  return resolveShortcutCommand(event, keybindings, options) === command;
}

const completedKeySequences = new WeakMap<object, ResolvedKeybindingRule>();

/**
 * A keydown that stands in for a finished key sequence. Its key is "Unidentified", so widgets
 * that read raw keys ignore it, while every `resolveShortcutCommand` caller sees the command.
 */
export function keySequenceCommandEvent(binding: ResolvedKeybindingRule): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Unidentified",
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  completedKeySequences.set(event, binding);
  return event;
}

export function isKeySequenceCommandEvent(event: ShortcutEventLike): boolean {
  return completedKeySequences.has(event.nativeEvent ?? event);
}

function sameBinding(left: ResolvedKeybindingRule, right: ResolvedKeybindingRule): boolean {
  return (
    left === right ||
    (left.command === right.command &&
      JSON.stringify([keybindingRuleSteps(left), left.whenAst]) ===
        JSON.stringify([keybindingRuleSteps(right), right.whenAst]))
  );
}

/**
 * Matches the keys pressed so far against every rule. A rule that needs more keys wins over one
 * that is already complete, so a prefix key shadows a shorter binding.
 */
export function resolveKeySequence(
  keys: ReadonlyArray<ShortcutEventLike>,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeySequenceMatch | null {
  const lastKey = keys.at(-1);
  if (!lastKey) return null;
  const platform = resolvePlatform(options);
  const context = resolveContext(options);
  if (options?.context?.editableFocus === undefined && typeof document !== "undefined") {
    context.editableFocus = isEditableFocused(lastKey.target ?? document.activeElement);
  }

  let completed: ResolvedKeybindingRule | null = null;
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding) continue;
    if (!matchesWhenClause(binding.whenAst, context)) continue;
    const steps = stepsForContext(binding, context);
    if (steps.length < keys.length) continue;
    const matches = keys.every((key, step) => {
      const shortcut = steps[step];
      return shortcut !== undefined && matchesKeybindingShortcut(key, shortcut, platform);
    });
    if (!matches) continue;
    if (steps.length > keys.length) return { type: "prefix" };
    completed ??= binding;
  }
  return completed ? { type: "command", binding: completed } : null;
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const sequence = completedKeySequences.get(event.nativeEvent ?? event);
  if (sequence) {
    return keybindings.some((binding) => sameBinding(binding, sequence)) ? sequence.command : null;
  }
  const match = resolveKeySequence([event], keybindings, options);
  return match?.type === "command" ? match.binding.command : null;
}

export function resolveChatShortcutCommand(
  event: ShortcutEventLike,
  primaryKeybindings: ResolvedKeybindingsConfig,
  activeKeybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const primaryCommand = resolveShortcutCommand(event, primaryKeybindings, options);
  if (primaryCommand !== null && projectScriptIdFromCommand(primaryCommand) === null) {
    return primaryCommand;
  }

  const activeCommand = resolveShortcutCommand(event, activeKeybindings, options);
  return activeCommand !== null && projectScriptIdFromCommand(activeCommand) !== null
    ? activeCommand
    : null;
}

export function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  if (key === "pageup") return "PageUp";
  if (key === "pagedown") return "PageDown";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): string {
  const keyLabel = formatShortcutKeyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const showMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  const showAlt = shortcut.altKey;
  const showShift = shortcut.shiftKey;

  if (useMetaForMod) {
    return `${showCtrl ? "\u2303" : ""}${showAlt ? "\u2325" : ""}${showShift ? "\u21e7" : ""}${showMeta ? "\u2318" : ""}${keyLabel}`;
  }

  const parts: string[] = [];
  if (showCtrl) parts.push("Ctrl");
  if (showAlt) parts.push("Alt");
  if (showShift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(keyLabel);
  return parts.join("+");
}

/** One label per key cap, in the order formatShortcutLabel joins them. */
export function formatShortcutKeyCaps(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): string[] {
  const mac = isMacPlatform(platform);
  const caps: string[] = [];
  if (shortcut.ctrlKey || (shortcut.modKey && !mac)) caps.push(mac ? "\u2303" : "Ctrl");
  if (shortcut.altKey) caps.push(mac ? "\u2325" : "Alt");
  if (shortcut.shiftKey) caps.push("\u21e7");
  if (shortcut.metaKey || (shortcut.modKey && mac)) caps.push(mac ? "\u2318" : "Meta");
  caps.push(formatShortcutKeyLabel(shortcut.key));
  return caps;
}

export function formatKeybindingStepsLabel(
  steps: ReadonlyArray<KeybindingShortcut>,
  platform = navigator.platform,
): string {
  return steps.map((shortcut) => formatShortcutLabel(shortcut, platform)).join(" ");
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand | null,
  options?: string | ResolvedShortcutLabelOptions,
): string | null {
  if (command === null) return null;
  const resolvedOptions =
    typeof options === "string"
      ? ({ platform: options } satisfies ResolvedShortcutLabelOptions)
      : options;
  const platform = resolvePlatform(resolvedOptions);
  const steps = effectiveKeybindingsForCommand(keybindings, command, resolvedOptions)[0];
  return steps ? formatKeybindingStepsLabel(steps, platform) : null;
}

export function threadJumpCommandForIndex(index: number): ThreadJumpKeybindingCommand | null {
  return THREAD_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function threadJumpIndexFromCommand(command: string): number | null {
  const index = THREAD_JUMP_KEYBINDING_COMMANDS.indexOf(command as ThreadJumpKeybindingCommand);
  return index === -1 ? null : index;
}

export function threadTraversalDirectionFromCommand(
  command: string | null,
): "previous" | "next" | null {
  if (command === "thread.previous") return "previous";
  if (command === "thread.next") return "next";
  return null;
}

export function isThreadNavigationShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  const command = resolveShortcutCommand(event, keybindings, options);
  return (
    threadTraversalDirectionFromCommand(command) !== null ||
    threadJumpIndexFromCommand(command ?? "") !== null
  );
}

export function shouldShowThreadJumpHintsForModifiers(
  modifiers: ShortcutModifierStateLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  // Holding a modifier is routine in a shell (Ctrl+C, Ctrl+R), so don't flash hints over it.
  if (resolveContext(options).terminalFocus) {
    return false;
  }

  const platform = resolvePlatform(options);

  for (const command of THREAD_JUMP_KEYBINDING_COMMANDS) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, command, options);
    if (!shortcut) continue;
    if (matchesKeybindingShortcutModifiers(modifiers, shortcut, platform)) {
      return true;
    }
  }

  return false;
}

export function modelPickerJumpCommandForIndex(
  index: number,
): ModelPickerJumpKeybindingCommand | null {
  return MODEL_PICKER_JUMP_KEYBINDING_COMMANDS[index] ?? null;
}

export function modelPickerJumpIndexFromCommand(command: string): number | null {
  const index = MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.indexOf(
    command as ModelPickerJumpKeybindingCommand,
  );
  return index === -1 ? null : index;
}

export function isTerminalToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.toggle", options);
}

export function isTerminalSplitShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.split", options);
}

export function isTerminalSplitVerticalShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.splitVertical", options);
}

export function isTerminalNewShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.new", options);
}

export function isTerminalCloseShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "terminal.close", options);
}

export function isDiffToggleShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return matchesCommandShortcut(event, keybindings, "diff.toggle", options);
}

export function isOpenFavoriteEditorShortcut(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): boolean {
  return (
    event.repeat !== true &&
    matchesCommandShortcut(event, keybindings, "editor.openFavorite", options)
  );
}

/**
 * Whether the keypress should bold text in the rich-text composer: Mod+B
 * without extra modifiers, with text selected. Tiptap binds the same chord, so
 * app shortcuts captured ahead of the editor yield only in that case. With no
 * selection an app binding on the chord wins (the sidebar toggle by default).
 */
export function isRichTextBoldShortcut(
  event: ShortcutEventLike,
  selection: Pick<Selection, "isCollapsed"> | null,
): boolean {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }
  return (
    selection !== null &&
    !selection.isCollapsed &&
    resolveEventKeys(event).has("b") &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

/** Mod+B, Mod+I and Mod+E, the mark chords the rich-text composer binds. */
export function isRichTextFormattingShortcut(event: ShortcutEventLike): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  const keys = resolveEventKeys(event);
  return keys.has("b") || keys.has("i") || keys.has("e");
}

export function isTerminalClearShortcut(
  event: ShortcutEventLike,
  platform = navigator.platform,
): boolean {
  if (event.type !== undefined && event.type !== "keydown") {
    return false;
  }

  const key = event.key.toLowerCase();

  if (key === "l" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    return true;
  }

  return (
    isMacPlatform(platform) &&
    key === "k" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function terminalDeleteShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (!isMacPlatform(platform)) {
    return null;
  }

  const key = normalizeEventKey(event.key);
  if (key !== "backspace") {
    return null;
  }

  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    ? TERMINAL_DELETE_TO_LINE_START
    : null;
}

export function terminalNavigationShortcutData(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  if (event.type !== undefined && event.type !== "keydown") {
    return null;
  }

  if (event.shiftKey) return null;

  const key = normalizeEventKey(event.key);
  if (key !== "arrowleft" && key !== "arrowright") {
    return null;
  }

  const moveWord = key === "arrowleft" ? TERMINAL_WORD_BACKWARD : TERMINAL_WORD_FORWARD;
  const moveLine = key === "arrowleft" ? TERMINAL_LINE_START : TERMINAL_LINE_END;

  if (isMacPlatform(platform)) {
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      return moveWord;
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      return moveLine;
    }
    return null;
  }

  if (event.altKey && !event.metaKey && !event.ctrlKey) {
    return moveWord;
  }

  return null;
}
