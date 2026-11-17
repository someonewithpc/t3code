import * as Schema from "effect/Schema";
import { ForwardCompatibleArray, TrimmedString } from "./baseSchemas.ts";

const MAX_KEYBINDING_VALUE_LENGTH = 64;
const MAX_KEYBINDING_WHEN_LENGTH = 256;
export const MAX_WHEN_EXPRESSION_DEPTH = 64;
export const MAX_SCRIPT_ID_LENGTH = 24;
export const MAX_KEYBINDINGS_COUNT = 256;
export const MAX_KEYBINDING_SEQUENCE_STEPS = 4;

export const THREAD_JUMP_KEYBINDING_COMMANDS = [
  "thread.jump.1",
  "thread.jump.2",
  "thread.jump.3",
  "thread.jump.4",
  "thread.jump.5",
  "thread.jump.6",
  "thread.jump.7",
  "thread.jump.8",
  "thread.jump.9",
] as const;
export type ThreadJumpKeybindingCommand = (typeof THREAD_JUMP_KEYBINDING_COMMANDS)[number];

export const MODEL_PICKER_JUMP_KEYBINDING_COMMANDS = [
  "modelPicker.jump.1",
  "modelPicker.jump.2",
  "modelPicker.jump.3",
  "modelPicker.jump.4",
  "modelPicker.jump.5",
  "modelPicker.jump.6",
  "modelPicker.jump.7",
  "modelPicker.jump.8",
  "modelPicker.jump.9",
] as const;
export type ModelPickerJumpKeybindingCommand =
  (typeof MODEL_PICKER_JUMP_KEYBINDING_COMMANDS)[number];

const THREAD_KEYBINDING_COMMANDS = [
  "thread.stop",
  "thread.steerQueuedMessage",
  "thread.editQueuedMessage",
  "thread.previous",
  "thread.next",
  "thread.copyReference",
  "thread.settle",
  "thread.pin",
  "thread.regenerateTitle",
  "thread.undo",
  ...THREAD_JUMP_KEYBINDING_COMMANDS,
] as const;

const MODEL_PICKER_KEYBINDING_COMMANDS = [
  "modelPicker.toggle",
  "modelPicker.previousProvider",
  "modelPicker.nextProvider",
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
] as const;

const TEXT_EDITING_KEYBINDING_COMMANDS = [
  "text.cursorForward",
  "text.cursorBackward",
  "text.cursorWordForward",
  "text.cursorWordBackward",
  "text.cursorLineStart",
  "text.cursorLineEnd",
  "text.cursorLineDown",
  "text.cursorLineUp",
  "text.cursorDocumentStart",
  "text.cursorDocumentEnd",
  "text.deleteForward",
  "text.deleteBackward",
  "text.cutWordForward",
  "text.cutWordBackward",
  "text.cutToLineEnd",
  "text.cutToLineStart",
  "text.cutSelection",
  "text.copySelection",
  "text.paste",
  "text.pasteOlder",
  "text.transposeCharacters",
  "text.anchorSelection",
  "text.clearSelection",
  "text.selectAll",
  "text.exchangePointAndMark",
  "text.transposeWords",
  "text.upcaseWord",
  "text.downcaseWord",
  "text.capitalizeWord",
  "text.newline",
  "text.undo",
] as const;
export type TextEditingKeybindingCommand = (typeof TEXT_EDITING_KEYBINDING_COMMANDS)[number];

export const STATIC_KEYBINDING_COMMANDS = [
  "workspace.focusNext",
  "workspace.focusPrevious",
  "sidebar.toggle",
  "navigation.back",
  "navigation.forward",
  "terminal.toggle",
  "terminal.split",
  "terminal.splitVertical",
  "terminal.new",
  "terminal.close",
  "rightPanel.toggle",
  "rightPanel.new",
  "threadPanel.toggle",
  "rightPanel.toggleMaximized",
  "rightPanel.close",
  "view.reopenClosed",
  "view.reload",
  "pullRequest.copyNumber",
  "diff.toggle",
  "preview.toggle",
  "preview.refresh",
  "preview.focusUrl",
  "preview.zoomIn",
  "preview.zoomOut",
  "preview.resetZoom",
  "preview.find",
  "commandPalette.toggle",
  "filePicker.toggle",
  "projectSearch.toggle",
  "usage.open",
  "theme.select",
  "appearance.cycle",
  "themeEditor.toggle",
  "composer.stash",
  "composer.sendAlternate",
  "composer.sendBackground",
  "composer.sendAndNewThread",
  "composer.dictation",
  "composer.host",
  "composer.cycleHost",
  "composer.effort",
  "composer.increaseEffort",
  "composer.decreaseEffort",
  "composer.mode",
  "composer.workspace",
  "composer.previousWorktree",
  "composer.branch",
  "chat.new",
  "chat.newLocal",
  "chat.newWithoutProject",
  "chat.find",
  "chat.findNext",
  "chat.findPrevious",
  "editor.openFavorite",
  "usage.cost",
  "usage.tokens",
  "usage.limits",
  "usage.period.day",
  "usage.period.week",
  "usage.period.month",
  "usage.period.quarter",
  ...MODEL_PICKER_KEYBINDING_COMMANDS,
  ...THREAD_KEYBINDING_COMMANDS,
  ...TEXT_EDITING_KEYBINDING_COMMANDS,
] as const;

export const SCRIPT_RUN_COMMAND_PATTERN = Schema.TemplateLiteral([
  Schema.Literal("script."),
  Schema.NonEmptyString.check(
    Schema.isMaxLength(MAX_SCRIPT_ID_LENGTH),
    Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
  ),
  Schema.Literal(".run"),
]);

export const KeybindingCommand = Schema.Union([
  Schema.Literals(STATIC_KEYBINDING_COMMANDS),
  SCRIPT_RUN_COMMAND_PATTERN,
]);
export type KeybindingCommand = typeof KeybindingCommand.Type;

export const KeybindingValue = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_KEYBINDING_VALUE_LENGTH),
);

export const KeybindingWhen = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_KEYBINDING_WHEN_LENGTH),
);
export const KeybindingRule = Schema.Struct({
  key: KeybindingValue,
  command: KeybindingCommand,
  when: Schema.optional(KeybindingWhen),
});
export type KeybindingRule = typeof KeybindingRule.Type;

export const KeybindingsConfig = Schema.Array(KeybindingRule).check(
  Schema.isMaxLength(MAX_KEYBINDINGS_COUNT),
);
export type KeybindingsConfig = typeof KeybindingsConfig.Type;

// Untrimmed: the `space` token resolves to the key " ".
const KeybindingShortcutKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_KEYBINDING_VALUE_LENGTH),
);

export const KeybindingShortcut = Schema.Struct({
  key: KeybindingShortcutKey,
  metaKey: Schema.Boolean,
  ctrlKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
  altKey: Schema.Boolean,
  modKey: Schema.Boolean,
});
export type KeybindingShortcut = typeof KeybindingShortcut.Type;

export const PreviewForwardedShortcut = Schema.Struct({
  command: KeybindingCommand,
  shortcut: KeybindingShortcut,
});
export type PreviewForwardedShortcut = typeof PreviewForwardedShortcut.Type;

const KeybindingWhenNodeRef = Schema.suspend(
  (): Schema.Codec<KeybindingWhenNode> => KeybindingWhenNode,
);
export const KeybindingWhenNode = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("identifier"),
    name: Schema.NonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("not"),
    node: KeybindingWhenNodeRef,
  }),
  Schema.Struct({
    type: Schema.Literal("and"),
    left: KeybindingWhenNodeRef,
    right: KeybindingWhenNodeRef,
  }),
  Schema.Struct({
    type: Schema.Literal("or"),
    left: KeybindingWhenNodeRef,
    right: KeybindingWhenNodeRef,
  }),
]);
export type KeybindingWhenNode =
  | { type: "identifier"; name: string }
  | { type: "not"; node: KeybindingWhenNode }
  | { type: "and"; left: KeybindingWhenNode; right: KeybindingWhenNode }
  | { type: "or"; left: KeybindingWhenNode; right: KeybindingWhenNode };

const ResolvedKeybindingShortcutRule = Schema.Struct({
  command: KeybindingCommand,
  shortcut: KeybindingShortcut,
  whenAst: Schema.optional(KeybindingWhenNode),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });

// No `shortcut` field: a client from before key sequences fails to decode the rule and drops
// it, instead of running the command on the first key alone.
const ResolvedKeybindingSequenceRule = Schema.Struct({
  command: KeybindingCommand,
  sequence: Schema.Array(KeybindingShortcut).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(MAX_KEYBINDING_SEQUENCE_STEPS),
  ),
  whenAst: Schema.optional(KeybindingWhenNode),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });

export const ResolvedKeybindingRule = Schema.Union([
  ResolvedKeybindingShortcutRule,
  ResolvedKeybindingSequenceRule,
]);
export type ResolvedKeybindingRule = typeof ResolvedKeybindingRule.Type;

/** Drops undecodable rules without failing the connection. */
export const ResolvedKeybindingsConfig = ForwardCompatibleArray(ResolvedKeybindingRule).check(
  Schema.isMaxLength(MAX_KEYBINDINGS_COUNT),
);
export type ResolvedKeybindingsConfig = typeof ResolvedKeybindingsConfig.Type;

export class KeybindingsConfigError extends Schema.TaggedError<KeybindingsConfigError>()(
  "KeybindingsConfigParseError",
  {
    configPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Unable to parse keybindings config at ${this.configPath}: ${this.detail}`;
  }
}

export const MAX_KEYBINDING_PROFILE_ID_LENGTH = 32;
export const MAX_KEYBINDING_PROFILES_COUNT = 32;
export const DEFAULT_KEYBINDING_PROFILE_ID = "default";

export const KeybindingProfileId = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_KEYBINDING_PROFILE_ID_LENGTH),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
export type KeybindingProfileId = typeof KeybindingProfileId.Type;

export const MAX_KEYBINDING_PROFILE_NAME_LENGTH = 64;

export const KeybindingProfileName = TrimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_KEYBINDING_PROFILE_NAME_LENGTH),
);

/** `extends` is null for a profile that starts from no shortcuts at all. */
export const KeybindingProfileSummary = Schema.Struct({
  id: KeybindingProfileId,
  name: KeybindingProfileName,
  builtIn: Schema.Boolean,
  extends: Schema.NullOr(KeybindingProfileId),
  // A custom profile's own rules, so clients can resolve what each profile inherits.
  keybindings: Schema.optional(
    ForwardCompatibleArray(KeybindingRule).check(Schema.isMaxLength(MAX_KEYBINDINGS_COUNT)),
  ),
});
export type KeybindingProfileSummary = typeof KeybindingProfileSummary.Type;

export const KeybindingProfileSummaries = ForwardCompatibleArray(KeybindingProfileSummary).check(
  Schema.isMaxLength(MAX_KEYBINDING_PROFILES_COUNT * 2),
);

export const KeybindingProfileMutation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("select"), profileId: KeybindingProfileId }),
  // The new profile extends `extends`, or nothing when null, and becomes active. Clients pick
  // the id, so every environment a change fans out to gets the same one.
  Schema.Struct({
    type: Schema.Literal("create"),
    id: KeybindingProfileId,
    name: KeybindingProfileName,
    extends: Schema.NullOr(KeybindingProfileId),
  }),
  Schema.Struct({
    type: Schema.Literal("rename"),
    profileId: KeybindingProfileId,
    name: KeybindingProfileName,
  }),
  Schema.Struct({ type: Schema.Literal("delete"), profileId: KeybindingProfileId }),
]);
export type KeybindingProfileMutation = typeof KeybindingProfileMutation.Type;

/**
 * The profile an edit from Settings is for. `copyOf` is set when the edit was made under a
 * built-in: the server then creates `profileId` as that copy, unless the edit changes nothing.
 */
export const KeybindingEditTarget = Schema.Struct({
  profileId: KeybindingProfileId,
  copyOf: Schema.optional(
    Schema.Struct({ extends: KeybindingProfileId, name: KeybindingProfileName }),
  ),
});
export type KeybindingEditTarget = typeof KeybindingEditTarget.Type;
