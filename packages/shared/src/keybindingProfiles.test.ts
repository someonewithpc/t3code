import { describe, expect, it } from "@effect/vitest";

import {
  keybindingEditTarget,
  keybindingProfileDefaults,
  keybindingProfileSummaries,
  resolveKeybindingProfileRules,
} from "./keybindingProfiles.ts";
import { DEFAULT_KEYBINDINGS } from "./keybindings.ts";

describe("resolveKeybindingProfileRules", () => {
  it("lets each profile replace what its parent binds for a command", () => {
    const resolved = resolveKeybindingProfileRules("child", [
      {
        id: "parent",
        name: "Parent",
        extends: "default",
        keybindings: [
          { key: "ctrl+b", command: "sidebar.toggle" },
          { key: "ctrl+j", command: "terminal.toggle" },
        ],
      },
      {
        id: "child",
        name: "Child",
        extends: "parent",
        keybindings: [{ key: "alt+b", command: "sidebar.toggle" }],
      },
    ]);
    if (!resolved.ok) throw new Error(resolved.reason);
    const keysFor = (command: string) =>
      resolved.rules.filter((rule) => rule.command === command).map((rule) => rule.key);
    expect(keysFor("sidebar.toggle")).toEqual(["alt+b"]);
    expect(keysFor("terminal.toggle")).toEqual(["ctrl+j"]);
    expect(keysFor("workspace.focusNext")).toEqual(["f6", "mod+f6"]);
  });
});

describe("keybindingProfileDefaults", () => {
  const profiles = keybindingProfileSummaries([
    {
      id: "parent",
      name: "Parent",
      extends: "default",
      keybindings: [{ key: "ctrl+b", command: "sidebar.toggle" }],
    },
    { id: "child", name: "Child", extends: "parent", keybindings: [] },
  ]);
  const keysFor = (rules: ReturnType<typeof keybindingProfileDefaults>, command: string) =>
    rules.filter((rule) => rule.command === command).map((rule) => rule.key);

  it("resets a custom profile to its resolved parent", () => {
    const defaults = keybindingProfileDefaults("child", profiles);
    expect(keysFor(defaults, "sidebar.toggle")).toEqual(["ctrl+b"]);
    expect(keysFor(defaults, "commandPalette.toggle")).toEqual(["mod+k"]);
  });

  it("resolves a profile that extends nothing to its own rules, with nothing to reset to", () => {
    const root = keybindingProfileSummaries([
      { id: "root", name: "Root", extends: null, keybindings: [] },
    ]);
    expect(resolveKeybindingProfileRules("root", [{ ...root.at(-1)!, keybindings: [] }])).toEqual({
      ok: true,
      rules: [],
    });
    expect(keybindingProfileDefaults("root", root)).toEqual([]);
  });

  it("resets a built-in to itself, and falls back to the stock defaults without profiles", () => {
    expect(keybindingProfileDefaults("default", profiles)).toEqual(DEFAULT_KEYBINDINGS);
    expect(keybindingProfileDefaults(undefined, undefined)).toBe(DEFAULT_KEYBINDINGS);
  });
});

describe("keybindingEditTarget", () => {
  it("names a copy of a built-in so it is free on every machine", () => {
    const everyProfile = keybindingProfileSummaries([
      { id: "my-default-copy", name: "Default copy", extends: "default", keybindings: [] },
      { id: "hugo", name: "Hugo", extends: "default", keybindings: [] },
    ]);
    const profile = (id: string) => everyProfile.find((candidate) => candidate.id === id)!;
    expect(keybindingEditTarget(profile("default"), everyProfile, "Default copy")).toEqual({
      profileId: "my-default-copy-2",
      copyOf: { extends: "default", name: "Default copy 2" },
    });
    expect(keybindingEditTarget(profile("hugo"), everyProfile, "Hugo copy")).toEqual({
      profileId: "hugo",
    });
  });
});

describe("the Emacs profile", () => {
  const resolved = resolveKeybindingProfileRules("emacs", []);
  if (!resolved.ok) throw new Error(resolved.reason);

  it("leaves single Ctrl and Alt letter keys to text editing on Linux", () => {
    const emacsKey = /^(?:mod|ctrl|alt)\+(?:[a-z]|space|\/|\[|\]|`)$/;
    const searchCommands = new Set(["chat.findNext", "chat.findPrevious", "preview.find"]);
    const offenders = resolved.rules.filter(
      (rule) =>
        emacsKey.test(rule.key) &&
        !rule.command.startsWith("text.") &&
        !(/^ctrl\+[rs]$/.test(rule.key) && searchCommands.has(rule.command)) &&
        !(rule.key === "ctrl+`" && rule.command === "terminal.toggle") &&
        !(rule.key === "alt+x" && rule.command === "commandPalette.toggle"),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the app commands it moves reachable", () => {
    const keysFor = (command: string) =>
      resolved.rules.filter((rule) => rule.command === command).map((rule) => rule.key);
    expect(keysFor("commandPalette.toggle")).toEqual(["alt+x", "meta+k"]);
    expect(keysFor("filePicker.toggle")).toEqual(["ctrl+x ctrl+f", "meta+p"]);
    expect(keysFor("terminal.toggle")).toEqual(["ctrl+c t", "ctrl+`", "meta+j"]);
  });
});
