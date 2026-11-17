import {
  DEFAULT_KEYBINDING_PROFILE_ID,
  type KeybindingCommand,
  type KeybindingEditTarget,
  KeybindingProfileId,
  type KeybindingProfileMutation,
  KeybindingProfileName,
  type KeybindingProfileSummary,
  KeybindingRule,
  KeybindingsConfigError,
  KeybindingShortcut,
  KeybindingWhenNode,
  MAX_KEYBINDING_PROFILES_COUNT,
  MAX_KEYBINDINGS_COUNT,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
  type ServerConfigIssue,
  type ServerRemoveKeybindingInput,
  ServerUpsertKeybindingResult,
  type ServerUpsertKeybindingInput,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Ref from "effect/Ref";
import * as Context from "effect/Context";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "./config.ts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import {
  compileResolvedKeybindingRule,
  compileResolvedKeybindingsConfig,
  keybindingRuleSteps,
  parseKeybindingSequence,
  parseKeybindingWhenExpression,
} from "@t3tools/shared/keybindings";
import {
  builtInKeybindingProfile,
  isBuiltInKeybindingProfileId,
  isKeybindingProfileNameTaken,
  type KeybindingProfileDefinition,
  keybindingProfileSummaries,
  newKeybindingProfileId,
  resolveKeybindingProfileRules,
  uniqueKeybindingProfileName,
} from "@t3tools/shared/keybindingProfiles";

export const ResolvedKeybindingFromConfig = KeybindingRule.pipe(
  Schema.decodeTo(
    Schema.toType(ResolvedKeybindingRule),
    SchemaTransformation.transformEffect({
      decode: (rule) =>
        Effect.succeed(compileResolvedKeybindingRule(rule)).pipe(
          Effect.filterOrFail(
            Predicate.isNotNull,
            () =>
              new SchemaIssue.InvalidValue({
                message: "Invalid keybinding rule",
              }),
          ),
          Effect.map((resolved) => resolved),
        ),

      encode: Effect.fn("keybindings.encode")(function* (resolved) {
        const key = encodeSteps(keybindingRuleSteps(resolved));
        if (!key) {
          return yield* Effect.fail(
            new SchemaIssue.InvalidValue({
              message: "Resolved shortcut cannot be encoded to key string",
            }),
          );
        }

        const when = resolved.whenAst ? encodeWhenAst(resolved.whenAst) : undefined;
        return {
          key,
          command: resolved.command,
          when,
        };
      }),
    }),
  ),
);

// Settings sends replace/remove targets in its own normalized spelling, which can differ from a
// hand-edited file ("cmd+k" vs "meta+k", "a&&b" vs "a && b"), so compare parsed forms.
function keybindingRuleIdentity(rule: KeybindingRule): string {
  const steps = parseKeybindingSequence(rule.key);
  const key = (steps && encodeSteps(steps)) ?? rule.key;
  if (rule.when === undefined) return JSON.stringify([rule.command, key, null]);
  const whenAst = parseKeybindingWhenExpression(rule.when);
  return JSON.stringify([rule.command, key, whenAst ? encodeWhenAst(whenAst) : rule.when]);
}

function isSameKeybindingRule(left: KeybindingRule, right: KeybindingRule): boolean {
  return keybindingRuleIdentity(left) === keybindingRuleIdentity(right);
}

function isSameRuleSet(left: ReadonlyArray<KeybindingRule>, right: ReadonlyArray<KeybindingRule>) {
  const leftIds = new Set(left.map(keybindingRuleIdentity));
  const rightIds = new Set(right.map(keybindingRuleIdentity));
  return leftIds.size === rightIds.size && [...leftIds].every((id) => rightIds.has(id));
}

const LATE_DEFAULT_KEYBINDINGS: ReadonlyArray<{
  readonly id: string;
  readonly alongside: KeybindingRule;
  readonly rule: KeybindingRule;
}> = [
  {
    id: "composer.sendBackground:mod+enter",
    alongside: {
      key: "mod+alt+enter",
      command: "composer.sendBackground",
      when: "composerFocus && draftThreadRoute",
    },
    rule: {
      key: "mod+enter",
      command: "composer.sendBackground",
      when: "composerFocus && draftThreadRoute",
    },
  },
];

/**
 * Rule sets older builds wrote for a command as its defaults, from the history of
 * DEFAULT_KEYBINDINGS, other than today's. A bare array that still holds one made no choice.
 */
const FORMER_DEFAULT_RULE_SETS: ReadonlyArray<ReadonlyArray<KeybindingRule>> = [
  ...THREAD_JUMP_KEYBINDING_COMMANDS.flatMap((command, index) => [
    [{ key: `mod+${index + 1}`, command }],
    [{ key: `mod+${index + 1}`, command, when: "isDesktop" }],
  ]),
  ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.map((command, index) => [
    { key: `mod+${index + 1}`, command, when: "modelPickerOpen" },
  ]),
  [
    {
      key: "mod+alt+enter",
      command: "composer.sendBackground",
      when: "composerFocus && draftThreadRoute",
    },
  ],
  // A command later builds dropped.
  [
    {
      key: "mod+/",
      command: "composer.toggleRichText",
      when: "!terminalFocus",
    } as unknown as KeybindingRule,
  ],
];

function keybindingShortcutContext(rule: KeybindingRule): string | null {
  const parsed = parseKeybindingSequence(rule.key);
  if (!parsed) return null;
  const encoded = encodeSteps(parsed);
  if (!encoded) return null;
  return `${encoded}\u0000${rule.when ?? ""}`;
}

function hasSameShortcutContext(left: KeybindingRule, right: KeybindingRule): boolean {
  const leftContext = keybindingShortcutContext(left);
  const rightContext = keybindingShortcutContext(right);
  if (!leftContext || !rightContext) return false;
  return leftContext === rightContext;
}

function keybindingRuleFromInput(input: ServerRemoveKeybindingInput): KeybindingRule {
  return input.when === undefined
    ? { key: input.key, command: input.command }
    : { key: input.key, command: input.command, when: input.when };
}

function replaceTargetFromUpsertInput(input: ServerUpsertKeybindingInput): KeybindingRule | null {
  if (!input.replace) return null;
  return input.replace.when === undefined
    ? { key: input.replace.key, command: input.replace.command }
    : { key: input.replace.key, command: input.replace.command, when: input.replace.when };
}

function encodeShortcut(shortcut: KeybindingShortcut): string | null {
  const modifiers: string[] = [];
  if (shortcut.modKey) modifiers.push("mod");
  if (shortcut.metaKey) modifiers.push("meta");
  if (shortcut.ctrlKey) modifiers.push("ctrl");
  if (shortcut.altKey) modifiers.push("alt");
  if (shortcut.shiftKey) modifiers.push("shift");
  if (!shortcut.key) return null;
  if (shortcut.key !== "+" && shortcut.key.includes("+")) return null;
  const key = shortcut.key === " " ? "space" : shortcut.key;
  return [...modifiers, key].join("+");
}

function encodeSteps(steps: readonly KeybindingShortcut[]): string | null {
  const keys: string[] = [];
  for (const step of steps) {
    const key = encodeShortcut(step);
    if (!key) return null;
    keys.push(key);
  }
  return keys.join(" ");
}

function encodeWhenAst(node: KeybindingWhenNode): string {
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!(${encodeWhenAst(node.node)})`;
    case "and":
      return `(${encodeWhenAst(node.left)} && ${encodeWhenAst(node.right)})`;
    case "or":
      return `(${encodeWhenAst(node.left)} || ${encodeWhenAst(node.right)})`;
  }
}

const RawJsonValue = fromLenientJson(Schema.Unknown);
const RawJsonValuePretty = fromJsonStringPretty(Schema.Unknown);
const decodeKeybindingRuleExit = Schema.decodeUnknownExit(KeybindingRule);
const decodeResolvedKeybindingFromConfigExit = Schema.decodeExit(ResolvedKeybindingFromConfig);
const decodeRawJsonValueExit = Schema.decodeUnknownExit(RawJsonValue);
const decodeProfileIdExit = Schema.decodeUnknownExit(KeybindingProfileId);
const decodeProfileHeaderExit = Schema.decodeUnknownExit(
  Schema.Struct({
    id: KeybindingProfileId,
    name: KeybindingProfileName,
    extends: Schema.optional(KeybindingProfileId),
  }),
);
const encodeRawJsonValuePretty = Schema.encodeEffect(RawJsonValuePretty);

export interface KeybindingsConfigState {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly keybindingProfiles: ReadonlyArray<KeybindingProfileSummary>;
  readonly activeKeybindingProfile: string;
  readonly issues: readonly ServerConfigIssue[];
}

const isSameKeybindingsConfigState = Schema.toEquivalence(ServerUpsertKeybindingResult);

export type KeybindingsChangeEvent = KeybindingsConfigState;

function trimIssueMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : "Invalid keybindings configuration.";
}

function malformedConfigIssue(detail: string): ServerConfigIssue {
  return {
    kind: "keybindings.malformed-config",
    message: trimIssueMessage(detail),
  };
}

function invalidEntryIssue(index: number, detail: string): ServerConfigIssue {
  return {
    kind: "keybindings.invalid-entry",
    index,
    message: trimIssueMessage(detail),
  };
}

/** `value` is written back as is, so entries this build cannot decode survive edits. */
interface RuleEntry {
  readonly value: unknown;
  readonly rule: KeybindingRule | null;
}

interface ProfileEntry {
  /** The id the file keys it by; null for an entry of the older array form that has none. */
  readonly key: string | null;
  readonly value: unknown;
  /** `extends` is absent in a hand-written profile that extends the default one. */
  readonly profile: {
    readonly id: string;
    readonly name: string;
    readonly extends?: string | undefined;
  } | null;
  readonly keybindings: ReadonlyArray<RuleEntry>;
}

interface KeybindingsFile {
  readonly extra: Readonly<Record<string, unknown>>;
  readonly profileId: string | undefined;
  readonly profiles: ReadonlyArray<ProfileEntry>;
  /** A bare array's rules, or a top-level "keybindings" list, which fold into a profile. */
  readonly looseRules: ReadonlyArray<RuleEntry>;
  /** The loose rules come from a bare array, written by a build from before profiles. */
  readonly bareArray: boolean;
}

type ParsedKeybindingsFile =
  | {
      readonly _tag: "Parsed";
      readonly file: KeybindingsFile;
      /** A bare array of rules, from before profiles. */
      readonly legacy: boolean;
      readonly issues: readonly ServerConfigIssue[];
      readonly warnings: ReadonlyArray<Record<string, unknown>>;
    }
  | { readonly _tag: "Malformed"; readonly detail: string; readonly cause: string | null };

const EMPTY_FILE: KeybindingsFile = {
  extra: {},
  profileId: undefined,
  profiles: [],
  looseRules: [],
  bareArray: false,
};

const MALFORMED_NOT_JSON = "expected a JSON object or array";
const MALFORMED_UNKNOWN_SHAPE =
  'expected an object with "profile", "profiles", or "keybindings", or an array of rules';
const FILE_KEYS = new Set(["profile", "profiles", "keybindings"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeRuleEntries(
  entries: ReadonlyArray<unknown>,
  location: string,
  issues: ServerConfigIssue[],
  warnings: Array<Record<string, unknown>>,
): RuleEntry[] {
  return entries.map((entry, index) => {
    const decodedRule = decodeKeybindingRuleExit(entry);
    // A rule can decode yet not compile, such as a bad shortcut or `when`.
    const compiled =
      decodedRule._tag === "Success"
        ? decodeResolvedKeybindingFromConfigExit(decodedRule.value)
        : decodedRule;
    if (decodedRule._tag === "Success" && compiled._tag === "Success") {
      return { value: decodedRule.value, rule: decodedRule.value };
    }
    const detail = compiled._tag === "Failure" ? Cause.pretty(compiled.cause) : "";
    issues.push(invalidEntryIssue(index, location ? `${location}: ${detail}` : detail));
    warnings.push({ location, index, entry, error: detail });
    return { value: entry, rule: null };
  });
}

function parseKeybindingsFile(raw: string): ParsedKeybindingsFile {
  const decoded = decodeRawJsonValueExit(raw);
  if (decoded._tag === "Failure") {
    return { _tag: "Malformed", detail: MALFORMED_NOT_JSON, cause: Cause.pretty(decoded.cause) };
  }
  const issues: ServerConfigIssue[] = [];
  const warnings: Array<Record<string, unknown>> = [];
  const value = decoded.value;
  if (Array.isArray(value)) {
    const looseRules = decodeRuleEntries(value, "", issues, warnings);
    return {
      _tag: "Parsed",
      file: { ...EMPTY_FILE, looseRules, bareArray: true },
      legacy: true,
      issues,
      warnings,
    };
  }
  if (!isRecord(value)) return { _tag: "Malformed", detail: MALFORMED_NOT_JSON, cause: null };

  const keys = Object.keys(value);
  // Only unknown keys means some other file; treating it as empty would let a write replace it.
  if (keys.length > 0 && !keys.some((key) => FILE_KEYS.has(key))) {
    return { _tag: "Malformed", detail: MALFORMED_UNKNOWN_SHAPE, cause: null };
  }
  const { profile: rawProfileId, profiles: rawProfiles, keybindings: rawRules, ...extra } = value;

  let profileId: string | undefined;
  if (rawProfileId !== undefined) {
    const decodedId = decodeProfileIdExit(rawProfileId);
    if (decodedId._tag === "Failure") {
      return {
        _tag: "Malformed",
        detail: 'invalid "profile"',
        cause: Cause.pretty(decodedId.cause),
      };
    }
    profileId = decodedId.value;
  }
  if (rawProfiles !== undefined && !Array.isArray(rawProfiles) && !isRecord(rawProfiles)) {
    return { _tag: "Malformed", detail: 'expected "profiles" to be an object', cause: null };
  }
  if (rawRules !== undefined && !Array.isArray(rawRules)) {
    return { _tag: "Malformed", detail: 'expected "keybindings" to be an array', cause: null };
  }

  // Profiles are keyed by id so a JSON deep merge can add one. Early builds wrote an array.
  const rawProfileEntries: Array<readonly [string | null, unknown]> = Array.isArray(rawProfiles)
    ? rawProfiles.map((entry) => {
        const id = isRecord(entry) ? entry["id"] : undefined;
        return [typeof id === "string" ? id : null, entry] as const;
      })
    : Object.entries(rawProfiles ?? {});
  const profiles: ProfileEntry[] = [];
  for (const [index, [key, entry]] of rawProfileEntries.entries()) {
    const invalid = (detail: string) => {
      issues.push(invalidEntryIssue(index, `profiles: ${detail}`));
      warnings.push({ location: "profiles", index, entry, error: detail });
      profiles.push({ key, value: entry, profile: null, keybindings: [] });
    };
    const header = decodeProfileHeaderExit(isRecord(entry) ? { ...entry, id: key } : entry);
    if (header._tag === "Failure") {
      invalid(Cause.pretty(header.cause));
      continue;
    }
    const { id } = header.value;
    const rules = isRecord(entry) ? entry["keybindings"] : undefined;
    if (rules !== undefined && !Array.isArray(rules)) {
      invalid(`profile "${id}": expected "keybindings" to be an array`);
    } else if (isBuiltInKeybindingProfileId(id)) {
      invalid(`"${id}" is a built-in profile and cannot be redefined`);
    } else if (profiles.some((other) => other.profile?.id === id)) {
      invalid(`profile "${id}" is defined twice`);
    } else if (profiles.filter((other) => other.profile).length >= MAX_KEYBINDING_PROFILES_COUNT) {
      invalid(`more than ${MAX_KEYBINDING_PROFILES_COUNT} profiles`);
    } else {
      profiles.push({
        key,
        value: entry,
        profile: header.value,
        keybindings: decodeRuleEntries(rules ?? [], `profile "${id}"`, issues, warnings),
      });
    }
  }

  return {
    _tag: "Parsed",
    file: {
      extra,
      profileId,
      profiles,
      looseRules: decodeRuleEntries(rawRules ?? [], "", issues, warnings),
      bareArray: false,
    },
    legacy: false,
    issues,
    warnings,
  };
}

function serializeKeybindingsFile(file: KeybindingsFile): unknown {
  return {
    profile: file.profileId ?? DEFAULT_KEYBINDING_PROFILE_ID,
    profiles: Object.fromEntries(
      file.profiles.flatMap((entry) => {
        if (!entry.profile) return entry.key === null ? [] : [[entry.key, entry.value]];
        const { id, name, extends: parent } = entry.profile;
        const { id: _id, extends: _extends, ...rest } = isRecord(entry.value) ? entry.value : {};
        return [
          [
            id,
            {
              ...rest,
              name,
              ...(parent === undefined ? {} : { extends: parent }),
              keybindings: entry.keybindings.map(({ value }) => value),
            },
          ],
        ];
      }),
    ),
    ...file.extra,
  };
}

function decodedRules(entries: ReadonlyArray<RuleEntry>): KeybindingRule[] {
  return entries.flatMap(({ rule }) => (rule ? [rule] : []));
}

function customProfileDefinitions(file: KeybindingsFile): KeybindingProfileDefinition[] {
  return file.profiles.flatMap(({ profile, keybindings }) =>
    profile
      ? [
          {
            id: profile.id,
            name: profile.name,
            extends: profile.extends ?? DEFAULT_KEYBINDING_PROFILE_ID,
            keybindings: decodedRules(keybindings),
          },
        ]
      : [],
  );
}

interface ActiveProfile {
  readonly id: string;
  readonly rules: ReadonlyArray<KeybindingRule>;
  readonly issue: string | null;
}

function activeProfileOf(file: KeybindingsFile): ActiveProfile {
  const requested = file.profileId ?? DEFAULT_KEYBINDING_PROFILE_ID;
  const resolved = resolveKeybindingProfileRules(requested, customProfileDefinitions(file));
  if (resolved.ok) return { id: requested, rules: resolved.rules, issue: null };
  const fallback = resolveKeybindingProfileRules(DEFAULT_KEYBINDING_PROFILE_ID, []);
  return {
    id: DEFAULT_KEYBINDING_PROFILE_ID,
    rules: fallback.ok ? fallback.rules : [],
    issue: `${resolved.reason}; using the default profile`,
  };
}

function configStateFromFile(
  file: KeybindingsFile,
  issues: readonly ServerConfigIssue[],
): KeybindingsConfigState {
  const folded = foldLooseRules(file);
  const active = activeProfileOf(folded);
  const problems = [
    ...(active.issue === null ? [] : [active.issue]),
    ...(active.rules.length > MAX_KEYBINDINGS_COUNT
      ? [
          `profile "${active.id}" resolves to ${active.rules.length} rules; only the last ${MAX_KEYBINDINGS_COUNT} apply`,
        ]
      : []),
  ];
  return {
    keybindings: compileResolvedKeybindingsConfig(active.rules),
    keybindingProfiles: keybindingProfileSummaries(customProfileDefinitions(folded)),
    activeKeybindingProfile: active.id,
    issues: [...issues, ...problems.map(malformedConfigIssue)],
  };
}

const ruleEntry = (rule: KeybindingRule): RuleEntry => ({ value: rule, rule });

/** A profile that binds a command replaces everything it inherits for it, so start from a copy. */
function withInheritedCommand(
  entries: ReadonlyArray<RuleEntry>,
  command: KeybindingCommand,
  inherited: ReadonlyArray<KeybindingRule>,
): ReadonlyArray<RuleEntry> {
  return entries.some(({ rule }) => rule?.command === command)
    ? entries
    : [...entries, ...inherited.map(ruleEntry)];
}

/** Rules that only repeat what the profile inherits are dropped, so the file holds choices. */
function withoutRedundantCommand(
  entries: ReadonlyArray<RuleEntry>,
  command: KeybindingCommand,
  inherited: ReadonlyArray<KeybindingRule>,
): ReadonlyArray<RuleEntry> {
  const own = decodedRules(entries).filter((rule) => rule.command === command);
  return own.length > 0 && isSameRuleSet(own, inherited)
    ? entries.filter(({ rule }) => rule?.command !== command)
    : entries;
}

/** A rule's fields as written, for entries this build cannot decode, such as removed commands. */
function writtenRule({ rule, value }: RuleEntry): KeybindingRule | null {
  if (rule) return rule;
  if (!isRecord(value)) return null;
  const { key, command, when } = value;
  if (typeof key !== "string" || typeof command !== "string") return null;
  if (when !== undefined && typeof when !== "string") return null;
  return { key, command, ...(when === undefined ? {} : { when }) } as KeybindingRule;
}

function takenProfileValues(file: KeybindingsFile, field: "id" | "name"): Set<string> {
  return new Set(
    file.profiles.flatMap(({ key, profile, value }) => {
      const taken =
        profile?.[field] ??
        (field === "id" ? key : isRecord(value) ? value[field] : undefined) ??
        undefined;
      return typeof taken === "string" ? [taken] : [];
    }),
  );
}

function withNewProfile(
  file: KeybindingsFile,
  profile: { readonly id: string; readonly name: string; readonly extends: string },
  keybindings: ReadonlyArray<RuleEntry> = [],
): KeybindingsFile {
  return {
    ...file,
    profileId: profile.id,
    profiles: [...file.profiles, { key: profile.id, value: {}, profile, keybindings }],
  };
}

/** For profiles the server names itself: conversions, and edits from clients without ids. */
function withGeneratedProfile(
  file: KeybindingsFile,
  name: string,
  parent: string,
  keybindings: ReadonlyArray<RuleEntry> = [],
): KeybindingsFile {
  const uniqueName = uniqueKeybindingProfileName(name, takenProfileValues(file, "name"));
  const id = newKeybindingProfileId(uniqueName, takenProfileValues(file, "id"));
  return withNewProfile(file, { id, name: uniqueName, extends: parent }, keybindings);
}

/** Why `profile` cannot be added as a new profile, or null when it can. */
function newProfileError(
  file: KeybindingsFile,
  profile: { readonly id: string; readonly name: string; readonly extends: string },
): string | null {
  if (isBuiltInKeybindingProfileId(profile.id) || takenProfileValues(file, "id").has(profile.id)) {
    return `a profile with the id "${profile.id}" already exists`;
  }
  if (isKeybindingProfileNameTaken(profile.name, takenProfileValues(file, "name"))) {
    return `a profile named "${profile.name}" already exists`;
  }
  if (customProfileDefinitions(file).length >= MAX_KEYBINDING_PROFILES_COUNT) {
    return `cannot define more than ${MAX_KEYBINDING_PROFILES_COUNT} profiles`;
  }
  const resolved = resolveKeybindingProfileRules(
    profile.id,
    customProfileDefinitions(withNewProfile(file, profile)),
  );
  return resolved.ok ? null : resolved.reason;
}

/**
 * Loose rules used to sit on top of the active profile. Those that change it move to a new
 * "Custom" profile extending it, which becomes active. A bare array from before profiles held
 * every default of its day, so a command matching a former default is no choice either.
 */
function foldLooseRules(file: KeybindingsFile): KeybindingsFile {
  if (file.looseRules.length === 0) return file;
  const rest = { ...file, looseRules: [], bareArray: false };
  const active = activeProfileOf(rest);
  const groups = new Map<string, RuleEntry[]>();
  for (const entry of file.looseRules) {
    const command = writtenRule(entry)?.command ?? "";
    groups.set(command, [...(groups.get(command) ?? []), entry]);
  }
  const isDefault = (command: string, entries: ReadonlyArray<RuleEntry>) => {
    const rules = entries.map(writtenRule);
    if (command === "" || rules.some((rule) => rule === null)) return false;
    const written = rules.filter((rule) => rule !== null);
    const sets = [
      active.rules.filter((rule) => rule.command === command),
      ...(file.bareArray ? FORMER_DEFAULT_RULE_SETS : []).filter(
        (set) => set[0]?.command === command,
      ),
    ];
    return sets.some((set) => isSameRuleSet(written, set));
  };
  const kept = new Set(
    [...groups].flatMap(([command, entries]) => (isDefault(command, entries) ? [] : entries)),
  );
  const entries = file.looseRules.filter((entry) => kept.has(entry));
  return entries.length === 0 ? rest : withGeneratedProfile(rest, "Custom", active.id, entries);
}

/**
 * Where an edit lands: `request.profileId` when it is the active custom profile, or a new copy of
 * the active built-in, which stays unchanged. A copy is kept only when the edit leaves it with
 * rules of its own. Clients from before profiles send no request and edit the active profile.
 */
function editTargetFor(
  file: KeybindingsFile,
  command: KeybindingCommand,
  request: KeybindingEditTarget | undefined,
) {
  const requested = resolveKeybindingProfileRules(
    file.profileId ?? DEFAULT_KEYBINDING_PROFILE_ID,
    customProfileDefinitions(file),
  );
  // Editing the fallback would put a copy of it over the profile the file names.
  if (!requested.ok) return { error: `${requested.reason}; select another profile to edit` };
  const active = activeProfileOf(file);
  let target = file;
  let index = file.profiles.findIndex((entry) => entry.profile?.id === active.id);
  const copying = index === -1;
  if (!copying && request && request.profileId !== active.id) {
    return { error: `profile "${active.id}" is active here, not "${request.profileId}"` };
  }
  if (copying) {
    if (request && request.copyOf?.extends !== active.id) {
      return {
        error: `profile "${active.id}" is active here, not "${request.copyOf?.extends ?? request.profileId}"`,
      };
    }
    const name = uniqueKeybindingProfileName(
      `${builtInKeybindingProfile(active.id)?.name ?? active.id} copy`,
      takenProfileValues(file, "name"),
    );
    const profile = request?.copyOf
      ? { id: request.profileId, ...request.copyOf }
      : {
          id: newKeybindingProfileId(name, takenProfileValues(file, "id")),
          name,
          extends: active.id,
        };
    const error = newProfileError(file, profile);
    if (error) return { error };
    target = withNewProfile(file, profile);
    index = target.profiles.length - 1;
  }
  const entry = target.profiles[index]!;
  const parent = resolveKeybindingProfileRules(
    entry.profile?.extends ?? DEFAULT_KEYBINDING_PROFILE_ID,
    customProfileDefinitions(target),
  );
  return {
    entries: entry.keybindings,
    inherited: parent.ok ? parent.rules.filter((rule) => rule.command === command) : [],
    write: (entries: ReadonlyArray<RuleEntry>): KeybindingsFile =>
      copying && entries.length === 0
        ? file
        : {
            ...target,
            profiles: target.profiles.map((other, otherIndex) =>
              otherIndex === index ? { ...other, keybindings: entries } : other,
            ),
          },
  };
}

export class Keybindings extends Context.Service<
  Keybindings,
  {
    readonly start: Effect.Effect<void, KeybindingsConfigError>;

    readonly ready: Effect.Effect<void, KeybindingsConfigError>;

    /** Creates the file, converts a bare-array file, and applies late defaults. */
    readonly migrateConfigOnStartup: Effect.Effect<void, KeybindingsConfigError>;

    readonly loadConfigState: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

    readonly getSnapshot: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

    readonly streamChanges: Stream.Stream<KeybindingsChangeEvent>;

    readonly revalidate: Effect.Effect<void, KeybindingsConfigError>;

    /** Acquire before reading a snapshot to buffer changes until the stream starts. */
    readonly subscribeChanges: Effect.Effect<
      Stream.Stream<KeybindingsChangeEvent>,
      never,
      Scope.Scope
    >;

    /**
     * Writes config atomically and enforces the max rule count by truncating
     * oldest entries when needed.
     */
    readonly upsertKeybindingRule: (
      input: ServerUpsertKeybindingInput,
    ) => Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

    readonly removeKeybindingRule: (
      input: ServerRemoveKeybindingInput,
    ) => Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;

    readonly mutateProfile: (
      mutation: KeybindingProfileMutation,
    ) => Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>;
  }
>()("t3/keybindings") {}

const make = Effect.gen(function* () {
  const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const upsertSemaphore = yield* Semaphore.make(1);
  const resolvedConfigCacheKey = "resolved" as const;
  const changesPubSub = yield* PubSub.unbounded<KeybindingsChangeEvent>();
  const lastEmittedStateRef = yield* Ref.make<KeybindingsConfigState | null>(null);
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, KeybindingsConfigError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));
  const emitChange = Effect.fn("keybindings.emitChange")(function* (
    configState: KeybindingsConfigState,
  ) {
    yield* Ref.set(lastEmittedStateRef, configState);
    yield* PubSub.publish(changesPubSub, configState);
  });

  const configError = (detail: string, cause?: unknown) =>
    new KeybindingsConfigError({
      configPath: keybindingsConfigPath,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  const readConfigExists = fs
    .exists(keybindingsConfigPath)
    .pipe(Effect.mapError((cause) => configError("failed to access keybindings config", cause)));

  const readRawConfig = fs
    .readFileString(keybindingsConfigPath)
    .pipe(Effect.mapError((cause) => configError("failed to read keybindings config", cause)));

  const readConfigFile = Effect.fn("keybindings.readConfigFile")(function* () {
    if (!(yield* readConfigExists)) return null;
    const parsed = parseKeybindingsFile(yield* readRawConfig);
    if (parsed._tag === "Parsed") {
      for (const warning of parsed.warnings) {
        yield* Effect.logWarning("ignoring invalid keybinding entry", {
          path: keybindingsConfigPath,
          ...warning,
        });
      }
    }
    return parsed;
  });

  const readWritableConfigFile = readConfigFile().pipe(
    Effect.flatMap((parsed) => {
      if (parsed === null) return Effect.succeed({ file: EMPTY_FILE, legacy: false });
      // A file this build cannot read is never overwritten with its fallback.
      if (parsed._tag === "Malformed") return Effect.fail(configError(parsed.detail));
      return Effect.succeed(parsed);
    }),
  );

  const appliedMigrationsPath = path.join(
    path.dirname(keybindingsConfigPath),
    "keybindings-migrations",
  );
  const readAppliedMigrationIds = fs.readFileString(appliedMigrationsPath).pipe(
    Effect.map((contents) => new Set(contents.split("\n").filter((line) => line.length > 0))),
    Effect.orElseSucceed(() => new Set<string>()),
  );
  const recordAppliedMigrations = (ids: Iterable<string>) =>
    writeFileStringAtomically({
      filePath: appliedMigrationsPath,
      contents: `${[...new Set(ids)].join("\n")}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => configError("failed to record keybinding migrations", cause)),
    );

  const writeConfigAtomically = (file: KeybindingsFile) =>
    encodeRawJsonValuePretty(serializeKeybindingsFile(file)).pipe(
      Effect.map((encoded) => `${encoded}\n`),
      Effect.flatMap((encoded) =>
        writeFileStringAtomically({
          filePath: keybindingsConfigPath,
          contents: encoded,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
      ),
      Effect.mapError((cause) => configError("failed to write keybindings config", cause)),
    );

  const loadConfigStateFromDisk = readConfigFile().pipe(
    Effect.map((parsed) => {
      if (parsed === null) return configStateFromFile(EMPTY_FILE, []);
      if (parsed._tag === "Parsed") return configStateFromFile(parsed.file, parsed.issues);
      const detail = parsed.cause ? `${parsed.detail} (${parsed.cause})` : parsed.detail;
      return configStateFromFile(EMPTY_FILE, [malformedConfigIssue(detail)]);
    }),
  );

  const resolvedConfigCache = yield* Cache.makeWith<
    typeof resolvedConfigCacheKey,
    KeybindingsConfigState,
    KeybindingsConfigError
  >(() => loadConfigStateFromDisk, {
    capacity: 1,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  });

  const loadConfigStateFromCacheOrDisk = Cache.get(resolvedConfigCache, resolvedConfigCacheKey);

  const reloadConfigState = Effect.gen(function* () {
    yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
    return yield* loadConfigStateFromCacheOrDisk;
  });

  const reloadAndEmit = Effect.gen(function* () {
    const configState = yield* reloadConfigState;
    yield* emitChange(configState);
    return configState;
  });

  const revalidateAndEmit = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const previousState = yield* Ref.get(lastEmittedStateRef);
      const configState = yield* reloadConfigState;
      if (!(previousState && isSameKeybindingsConfigState(previousState, configState))) {
        yield* emitChange(configState);
      }
      return configState;
    }),
  );

  const mutate = (
    update: (file: KeybindingsFile) => Effect.Effect<KeybindingsFile, KeybindingsConfigError>,
  ) =>
    upsertSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const { file } = yield* readWritableConfigFile;
        yield* writeConfigAtomically(yield* update(foldLooseRules(file)));
        return yield* reloadAndEmit;
      }),
    );

  const requireRoom = (entries: ReadonlyArray<RuleEntry>) =>
    entries.length > MAX_KEYBINDINGS_COUNT
      ? Effect.fail(configError(`a profile holds at most ${MAX_KEYBINDINGS_COUNT} rules`))
      : Effect.succeed(entries);

  /** Returns the late defaults a full layer could not take, which stay pending. */
  const applyLateDefaults = (
    file: KeybindingsFile,
    pending: typeof LATE_DEFAULT_KEYBINDINGS,
  ): {
    readonly file: KeybindingsFile;
    readonly changed: boolean;
    readonly skipped: ReadonlySet<string>;
  } => {
    const skipped = new Set<string>();
    let changed = false;
    const apply = (entries: ReadonlyArray<RuleEntry>) => {
      const next = [...entries];
      for (const { id, alongside, rule } of pending) {
        const rules = decodedRules(next);
        if (
          !rules.some((entry) => isSameKeybindingRule(entry, alongside)) ||
          rules.some(
            (entry) =>
              hasSameShortcutContext(entry, rule) ||
              isSameKeybindingRule(entry, { ...rule, when: "false" }),
          )
        ) {
          continue;
        }
        if (next.length >= MAX_KEYBINDINGS_COUNT) {
          skipped.add(id);
          continue;
        }
        next.push(ruleEntry(rule));
        changed = true;
      }
      return next;
    };
    return {
      file: {
        ...file,
        looseRules: apply(file.looseRules),
        profiles: file.profiles.map((entry) =>
          entry.profile ? { ...entry, keybindings: apply(entry.keybindings) } : entry,
        ),
      },
      changed,
      skipped,
    };
  };

  const migrateConfigOnStartup = upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const appliedMigrationIds = yield* readAppliedMigrationIds;
      const pending = LATE_DEFAULT_KEYBINDINGS.filter((late) => !appliedMigrationIds.has(late.id));
      const parsed = yield* readConfigFile();
      if (parsed === null) {
        yield* writeConfigAtomically(EMPTY_FILE);
        if (pending.length > 0) {
          yield* recordAppliedMigrations([
            ...appliedMigrationIds,
            ...LATE_DEFAULT_KEYBINDINGS.map((late) => late.id),
          ]);
        }
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }
      if (parsed._tag === "Malformed") {
        yield* Effect.logWarning("skipping keybindings migration because the config is malformed", {
          path: keybindingsConfigPath,
          detail: parsed.detail,
        });
        yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
        return;
      }

      const late = applyLateDefaults(parsed.file, pending);
      // Older builds wrote every default into a bare array, so only commands that differ from the
      // defaults are the user's choice. Late defaults go in first so they count as defaults.
      const file = foldLooseRules(late.file);
      if (late.file.looseRules.length > 0) {
        yield* Effect.logInfo("moving loose keybindings into a profile", {
          path: keybindingsConfigPath,
          profile: file.profileId ?? DEFAULT_KEYBINDING_PROFILE_ID,
        });
      }
      if (parsed.legacy) {
        // Builds from before profiles cannot read the new format, so keep what they can.
        yield* writeFileStringAtomically({
          filePath: `${keybindingsConfigPath}.pre-profiles`,
          contents: yield* readRawConfig,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError((cause) => configError("failed to back up keybindings config", cause)),
        );
      }
      if (parsed.legacy || late.changed || file !== late.file) {
        yield* writeConfigAtomically(file);
      }
      const settled = pending.filter((entry) => !late.skipped.has(entry.id));
      if (settled.length > 0) {
        yield* recordAppliedMigrations([...appliedMigrationIds, ...settled.map(({ id }) => id)]);
      }
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const keybindingsConfigDir = path.dirname(keybindingsConfigPath);
    const keybindingsConfigFile = path.basename(keybindingsConfigPath);
    const keybindingsConfigPathResolved = path.resolve(keybindingsConfigPath);

    yield* fs
      .makeDirectory(keybindingsConfigDir, { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          configError("failed to prepare keybindings config directory", cause),
        ),
      );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    // Saves emit multiple events; fs.watch may fire before content is flushed.
    const debouncedKeybindingsEvents = fs.watch(keybindingsConfigDir).pipe(
      Stream.filter((event) => {
        return (
          event.path === keybindingsConfigFile ||
          event.path === keybindingsConfigPath ||
          path.resolve(keybindingsConfigDir, event.path) === keybindingsConfigPathResolved
        );
      }),
      Stream.debounce(Duration.millis(100)),
    );

    yield* Stream.runForEach(debouncedKeybindingsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  const start = Effect.gen(function* () {
    const alreadyStarted = yield* Ref.get(startedRef);
    if (alreadyStarted) {
      return yield* Deferred.await(startedDeferred);
    }

    yield* Ref.set(startedRef, true);
    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* migrateConfigOnStartup;
      yield* Cache.invalidate(resolvedConfigCache, resolvedConfigCacheKey);
      const initialState = yield* loadConfigStateFromCacheOrDisk;
      yield* Ref.set(lastEmittedStateRef, initialState);
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  const upsertKeybindingRule = (input: ServerUpsertKeybindingInput) =>
    mutate(
      Effect.fn("keybindings.upsertKeybindingRule")(function* (file) {
        const rule = keybindingRuleFromInput(input);
        const replaceTarget = replaceTargetFromUpsertInput(input);
        const layer = editTargetFor(file, rule.command, input.profile);
        if ("error" in layer) return yield* configError(layer.error);
        const retained = withInheritedCommand(layer.entries, rule.command, layer.inherited).filter(
          ({ rule: entry }) =>
            !entry ||
            ((!replaceTarget || !isSameKeybindingRule(entry, replaceTarget)) &&
              !isSameKeybindingRule(entry, rule)),
        );
        const entries = withoutRedundantCommand(
          [...retained, ruleEntry(rule)],
          rule.command,
          layer.inherited,
        );
        return layer.write(yield* requireRoom(entries));
      }),
    );

  const removeKeybindingRule = (input: ServerRemoveKeybindingInput) =>
    mutate((file) => {
      const target = keybindingRuleFromInput(input);
      const layer = editTargetFor(file, target.command, input.profile);
      if ("error" in layer) return Effect.fail(configError(layer.error));
      let entries = withInheritedCommand(layer.entries, target.command, layer.inherited).filter(
        ({ rule }) => !rule || !isSameKeybindingRule(rule, target),
      );
      // With nothing left the inherited rules would come back, so keep the removal as an unassign.
      if (
        !entries.some(({ rule }) => rule?.command === target.command) &&
        layer.inherited.some((rule) => isSameKeybindingRule(rule, target))
      ) {
        entries = [...entries, ruleEntry({ ...target, when: "false" })];
      }
      return requireRoom(withoutRedundantCommand(entries, target.command, layer.inherited)).pipe(
        Effect.map(layer.write),
      );
    });

  const mutateProfile = (mutation: KeybindingProfileMutation) =>
    mutate(
      Effect.fn("keybindings.mutateProfile")(function* (file) {
        const customProfiles = customProfileDefinitions(file);
        const requireResolvable = Effect.fnUntraced(function* (profileId: string) {
          const resolved = resolveKeybindingProfileRules(profileId, customProfiles);
          if (!resolved.ok) return yield* configError(resolved.reason);
        });
        const requireCustom = Effect.fnUntraced(function* (profileId: string) {
          if (isBuiltInKeybindingProfileId(profileId)) {
            return yield* configError(`"${profileId}" is a built-in profile`);
          }
          const index = file.profiles.findIndex((entry) => entry.profile?.id === profileId);
          if (index === -1) return yield* configError(`unknown keybinding profile "${profileId}"`);
          return index;
        });
        switch (mutation.type) {
          case "select": {
            yield* requireResolvable(mutation.profileId);
            return { ...file, profileId: mutation.profileId };
          }
          case "create": {
            yield* requireResolvable(mutation.extends);
            const profile = { id: mutation.id, name: mutation.name, extends: mutation.extends };
            const error = newProfileError(file, profile);
            if (error) return yield* configError(error);
            return withNewProfile(file, profile);
          }
          case "rename": {
            const index = yield* requireCustom(mutation.profileId);
            const others = takenProfileValues(
              { ...file, profiles: file.profiles.filter((_, entryIndex) => entryIndex !== index) },
              "name",
            );
            if (isKeybindingProfileNameTaken(mutation.name, others)) {
              return yield* configError(`a profile named "${mutation.name}" already exists`);
            }
            return {
              ...file,
              profiles: file.profiles.map((entry, entryIndex) =>
                entryIndex === index && entry.profile
                  ? { ...entry, profile: { ...entry.profile, name: mutation.name } }
                  : entry,
              ),
            };
          }
          case "delete": {
            const index = yield* requireCustom(mutation.profileId);
            const child = customProfiles.find((profile) => profile.extends === mutation.profileId);
            if (child) {
              return yield* configError(`profile "${child.id}" extends "${mutation.profileId}"`);
            }
            const parent =
              customProfiles.find((profile) => profile.id === mutation.profileId)?.extends ??
              DEFAULT_KEYBINDING_PROFILE_ID;
            return {
              ...file,
              profileId: file.profileId === mutation.profileId ? parent : file.profileId,
              profiles: file.profiles.filter((_, entryIndex) => entryIndex !== index),
            };
          }
        }
      }),
    );

  return {
    start,
    ready: Deferred.await(startedDeferred),
    migrateConfigOnStartup,
    loadConfigState: loadConfigStateFromCacheOrDisk,
    getSnapshot: loadConfigStateFromCacheOrDisk,
    revalidate: revalidateAndEmit,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
    get subscribeChanges() {
      return PubSub.subscribe(changesPubSub).pipe(Effect.map(Stream.fromSubscription));
    },
    upsertKeybindingRule,
    removeKeybindingRule,
    mutateProfile,
  } satisfies Keybindings["Service"];
});

export const layer = Layer.effect(Keybindings, make);
