import {
  DEFAULT_KEYBINDING_PROFILE_ID,
  type KeybindingEditTarget,
  type KeybindingProfileSummary,
  type KeybindingRule,
  MAX_KEYBINDING_PROFILE_ID_LENGTH,
  MAX_KEYBINDING_PROFILE_NAME_LENGTH,
} from "@t3tools/contracts";

import { EMACS_KEYBINDINGS } from "./emacsKeybindings.ts";
import { DEFAULT_KEYBINDINGS } from "./keybindings.ts";

export interface KeybindingProfileDefinition {
  readonly id: string;
  readonly name: string;
  /** Null for a root, which starts from no shortcuts. */
  readonly extends: string | null;
  readonly keybindings: ReadonlyArray<KeybindingRule>;
}

// Add a built-in here with its own rules and the built-in it extends. Built-in ids never start
// with CUSTOM_KEYBINDING_PROFILE_ID_PREFIX.
const BUILT_IN_KEYBINDING_PROFILES: ReadonlyArray<KeybindingProfileDefinition> = [
  {
    id: DEFAULT_KEYBINDING_PROFILE_ID,
    name: "Default",
    extends: null,
    keybindings: DEFAULT_KEYBINDINGS,
  },
  {
    id: "emacs",
    name: "Emacs",
    extends: DEFAULT_KEYBINDING_PROFILE_ID,
    keybindings: EMACS_KEYBINDINGS,
  },
];

const MAX_KEYBINDING_PROFILE_DEPTH = 8;

/** Generated custom ids start with this, so a later built-in cannot take a user's id. */
const CUSTOM_KEYBINDING_PROFILE_ID_PREFIX = "my-";

export function newKeybindingProfileId(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = `${CUSTOM_KEYBINDING_PROFILE_ID_PREFIX}${slug || "profile"}`;
  for (let suffix = 1; ; ++suffix) {
    const tail = suffix === 1 ? "" : `-${suffix}`;
    const id = `${base.slice(0, MAX_KEYBINDING_PROFILE_ID_LENGTH - tail.length).replace(/-+$/, "")}${tail}`;
    if (!taken.has(id) && !isBuiltInKeybindingProfileId(id)) return id;
  }
}

export function isKeybindingProfileNameTaken(name: string, taken: ReadonlySet<string>): boolean {
  return taken.has(name) || BUILT_IN_KEYBINDING_PROFILES.some((profile) => profile.name === name);
}

/** `name`, or `name 2`, `name 3` and so on when a profile already has it. */
export function uniqueKeybindingProfileName(name: string, taken: ReadonlySet<string>): string {
  for (let suffix = 1; ; ++suffix) {
    const tail = suffix === 1 ? "" : ` ${suffix}`;
    const candidate = `${name.slice(0, MAX_KEYBINDING_PROFILE_NAME_LENGTH - tail.length).trimEnd()}${tail}`;
    if (!isKeybindingProfileNameTaken(candidate, taken)) return candidate;
  }
}

/**
 * Where Settings sends an edit: the active custom profile, or a new copy of the active built-in
 * named `copyName`, with an id and name free in every environment the edit fans out to.
 */
export function keybindingEditTarget(
  active: KeybindingProfileSummary,
  everyProfile: ReadonlyArray<KeybindingProfileSummary>,
  copyName: string,
): KeybindingEditTarget {
  if (!active.builtIn) return { profileId: active.id };
  const name = uniqueKeybindingProfileName(
    copyName,
    new Set(everyProfile.map((profile) => profile.name)),
  );
  return {
    profileId: newKeybindingProfileId(name, new Set(everyProfile.map((profile) => profile.id))),
    copyOf: { extends: active.id, name },
  };
}

export function builtInKeybindingProfile(id: string): KeybindingProfileDefinition | undefined {
  return BUILT_IN_KEYBINDING_PROFILES.find((profile) => profile.id === id);
}

export function isBuiltInKeybindingProfileId(id: string): boolean {
  return builtInKeybindingProfile(id) !== undefined;
}

/** A layer's rules for a command replace every rule the base has for that command. */
export function mergeKeybindingLayer(
  base: ReadonlyArray<KeybindingRule>,
  layer: ReadonlyArray<KeybindingRule>,
): ReadonlyArray<KeybindingRule> {
  if (layer.length === 0) return base;
  const commands = new Set(layer.map((rule) => rule.command));
  return [...base.filter((rule) => !commands.has(rule.command)), ...layer];
}

export type KeybindingProfileResolution =
  | { readonly ok: true; readonly rules: ReadonlyArray<KeybindingRule> }
  | { readonly ok: false; readonly reason: string };

/** Flattens a profile and everything it extends. Built-in ids win over custom ones. */
export function resolveKeybindingProfileRules(
  profileId: string,
  customProfiles: ReadonlyArray<KeybindingProfileDefinition>,
): KeybindingProfileResolution {
  const chain: KeybindingProfileDefinition[] = [];
  let current: string | null = profileId;
  while (current !== null) {
    const id: string = current;
    if (chain.some((profile) => profile.id === id)) {
      return { ok: false, reason: `profile "${profileId}" extends itself through "${id}"` };
    }
    if (chain.length >= MAX_KEYBINDING_PROFILE_DEPTH) {
      return { ok: false, reason: `profile "${profileId}" extends too many profiles` };
    }
    const profile =
      builtInKeybindingProfile(id) ?? customProfiles.find((candidate) => candidate.id === id);
    if (!profile) return { ok: false, reason: `unknown keybinding profile "${id}"` };
    chain.push(profile);
    current = profile.extends;
  }
  return {
    ok: true,
    rules: chain.reduceRight<ReadonlyArray<KeybindingRule>>(
      (rules, profile) => mergeKeybindingLayer(rules, profile.keybindings),
      [],
    ),
  };
}

export function keybindingProfileSummaries(
  customProfiles: ReadonlyArray<KeybindingProfileDefinition>,
): ReadonlyArray<KeybindingProfileSummary> {
  return [
    ...BUILT_IN_KEYBINDING_PROFILES.map(({ id, name, extends: parent }) => ({
      id,
      name,
      builtIn: true,
      extends: parent,
    })),
    ...customProfiles.map(({ id, name, extends: parent, keybindings }) => ({
      id,
      name,
      builtIn: false,
      extends: parent,
      keybindings,
    })),
  ];
}

/**
 * The rules Settings resets to and marks as defaults: a built-in's own rules, or what a custom
 * profile inherits from its parent. Servers from before profiles, and a built-in this build does
 * not ship, fall back to the stock defaults.
 */
export function keybindingProfileDefaults(
  activeProfileId: string | undefined,
  profiles: ReadonlyArray<KeybindingProfileSummary> | undefined,
): ReadonlyArray<KeybindingRule> {
  const active = profiles?.find((profile) => profile.id === activeProfileId);
  if (!profiles || !active) return DEFAULT_KEYBINDINGS;
  const target = active.builtIn ? active.id : active.extends;
  if (target === null) return [];
  const resolved = resolveKeybindingProfileRules(
    target,
    profiles.flatMap((profile) =>
      profile.builtIn
        ? []
        : [
            {
              id: profile.id,
              name: profile.name,
              extends: profile.extends,
              keybindings: profile.keybindings ?? [],
            },
          ],
    ),
  );
  return resolved.ok ? resolved.rules : DEFAULT_KEYBINDINGS;
}
