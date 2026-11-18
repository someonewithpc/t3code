import {
  KeybindingCommand,
  KeybindingRule,
  KeybindingsConfig,
  type ResolvedKeybindingRule,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerConfig from "./config.ts";
import * as Keybindings from "./keybindings.ts";
import * as SharedKeybindings from "@t3tools/shared/keybindings";
import { KeybindingsConfigError, MAX_KEYBINDINGS_COUNT } from "@t3tools/contracts";

const KeybindingsConfigJson = Schema.fromJsonString(KeybindingsConfig);
const encodeKeybindingsConfigJson = Schema.encodeEffect(KeybindingsConfigJson);
const decodeKeybindingsConfig = Schema.decodeUnknownEffect(KeybindingsConfig);
const layerKeybindings = () => {
  return Keybindings.layer.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-keybindings-test-",
        }),
      ),
    ),
  );
};

const toDetailResult = <A, R>(effect: Effect.Effect<A, KeybindingsConfigError, R>) =>
  effect.pipe(
    Effect.mapError((error) => error.detail),
    Effect.result,
  );

const writeKeybindingsConfig = (configPath: string, rules: readonly KeybindingRule[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const encoded = yield* encodeKeybindingsConfigJson(rules);
    yield* fileSystem.makeDirectory(path.dirname(configPath), { recursive: true });
    yield* fileSystem.writeFileString(configPath, encoded);
  });

const readKeybindingsFile = (configPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return JSON.parse(yield* fileSystem.readFileString(configPath));
  });

/** The active custom profile's own rules, as written. */
const readActiveProfileEntries = (configPath: string) =>
  Effect.gen(function* () {
    const file = yield* readKeybindingsFile(configPath);
    return (file.profiles[file.profile]?.keybindings ?? []) as unknown[];
  });

/** The active profile's own rules, then the project script shortcuts. */
const readKeybindingsConfig = (configPath: string) =>
  Effect.gen(function* () {
    const file = yield* readKeybindingsFile(configPath);
    return yield* decodeKeybindingsConfig([
      ...(yield* readActiveProfileEntries(configPath)),
      ...(file.scripts ?? []),
    ]);
  });

const commandRules = (
  rules: ReadonlyArray<ResolvedKeybindingRule>,
  command: KeybindingCommand,
): ReadonlyArray<ResolvedKeybindingRule> => rules.filter((rule) => rule.command === command);

it.layer(NodeServices.layer)("keybindings", (it) => {
  it.effect("parses shortcuts including plus key", () =>
    Effect.sync(() => {
      assert.deepEqual(SharedKeybindings.parseKeybindingShortcut("mod+j"), {
        key: "j",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      });
      assert.deepEqual(SharedKeybindings.parseKeybindingShortcut("mod++"), {
        key: "+",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      });
    }),
  );

  it.effect("parses key sequences without changing how single chords parse", () =>
    Effect.sync(() => {
      const chord = (key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => ({
        key,
        metaKey: false,
        ctrlKey: modifiers.ctrlKey ?? false,
        shiftKey: modifiers.shiftKey ?? false,
        altKey: false,
        modKey: false,
      });
      const ctrlX = chord("x", { ctrlKey: true });
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence("ctrl + x"), [ctrlX]);
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence(" ctrl+ shift +x "), [
        chord("x", { ctrlKey: true, shiftKey: true }),
      ]);
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence("ctrl+space"), [
        chord(" ", { ctrlKey: true }),
      ]);
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence("ctrl + +"), [
        chord("+", { ctrlKey: true }),
      ]);
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence("ctrl+x  ctrl+x"), [ctrlX, ctrlX]);
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence("ctrl+x h"), [ctrlX, chord("h")]);
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence("ctrl+x space"), [
        ctrlX,
        chord(" "),
      ]);
      assert.isNull(SharedKeybindings.parseKeybindingShortcut("ctrl+x h"));
      assert.isNull(SharedKeybindings.parseKeybindingSequence("ctrl+x h+j"));
      assert.isNull(SharedKeybindings.parseKeybindingSequence("a b c d e"));
      assert.deepEqual(SharedKeybindings.parseKeybindingSequence("a b c d")?.length, 4);
    }),
  );

  it.effect("compiles valid rule with parsed when AST", () =>
    Effect.sync(() => {
      const compiled = SharedKeybindings.compileResolvedKeybindingRule({
        key: "mod+d",
        command: "terminal.split",
        when: "terminalOpen && !terminalFocus",
      });

      assert.deepEqual(compiled, {
        command: "terminal.split",
        shortcut: {
          key: "d",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
        whenAst: {
          type: "and",
          left: { type: "identifier", name: "terminalOpen" },
          right: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      });
    }),
  );

  it.effect("rejects invalid rules", () =>
    Effect.sync(() => {
      assert.isNull(
        SharedKeybindings.compileResolvedKeybindingRule({
          key: "mod+shift+d+o",
          command: "terminal.new",
        }),
      );

      assert.isNull(
        SharedKeybindings.compileResolvedKeybindingRule({
          key: "mod+d",
          command: "terminal.split",
          when: "terminalFocus && (",
        }),
      );

      assert.isNull(
        SharedKeybindings.compileResolvedKeybindingRule({
          key: "ctrl+x mod+shift+d+o",
          command: "terminal.new",
        }),
      );

      assert.isNull(
        SharedKeybindings.compileResolvedKeybindingRule({
          key: "mod+d",
          command: "terminal.split",
          when: `${"!".repeat(300)}terminalFocus`,
        }),
      );
    }),
  );

  it.effect("creates a config without defaults when the file is missing", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      assert.isFalse(yield* fs.exists(keybindingsConfigPath));

      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.migrateConfigOnStartup;

      assert.deepEqual(yield* readKeybindingsFile(keybindingsConfigPath), {
        profile: "default",
        profiles: {},
        scripts: [],
      });
      const state = yield* keybindings.loadConfigState;
      assert.deepEqual(state.keybindings, SharedKeybindings.DEFAULT_RESOLVED_KEYBINDINGS);
      assert.equal(state.activeKeybindingProfile, "default");
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("uses defaults in runtime when config is malformed without overriding file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(keybindingsConfigPath, "{ not-json");

      const configState = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.loadConfigState;
      });

      assert.deepEqual(
        configState.keybindings,
        SharedKeybindings.compileResolvedKeybindingsConfig(SharedKeybindings.DEFAULT_KEYBINDINGS),
      );
      assert.deepEqual(configState.issues, [
        {
          kind: "keybindings.malformed-config",
          message: configState.issues[0]?.message ?? "",
        },
      ]);
      assert.equal(yield* fs.readFileString(keybindingsConfigPath), "{ not-json");
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("ignores invalid entries in runtime and reports them as issues", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify([
          { key: "mod+j", command: "terminal.toggle" },
          { key: "mod+shift+d+o", command: "terminal.new" },
          { key: "mod+x", command: "invalid.command" },
          { key: "ctrl+x ctrl+j", command: "terminal.toggle", when: "terminalOpen" },
        ]),
      );

      const configState = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.loadConfigState;
      });

      const ctrl = { metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, modKey: false };
      assert.deepInclude(configState.keybindings, {
        command: "terminal.toggle",
        sequence: [
          { key: "x", ...ctrl },
          { key: "j", ...ctrl },
        ],
        whenAst: { type: "identifier", name: "terminalOpen" },
      });
      assert.isTrue(configState.keybindings.some((entry) => entry.command === "terminal.toggle"));
      assert.isFalse(
        configState.keybindings.some((entry) => String(entry.command) === "invalid.command"),
      );
      assert.deepEqual(configState.issues, [
        {
          kind: "keybindings.invalid-entry",
          index: 1,
          message: configState.issues[0]?.message ?? "",
        },
        {
          kind: "keybindings.invalid-entry",
          index: 2,
          message: configState.issues[1]?.message ?? "",
        },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect(
    "migrates a bare array to the profile format, keeping the commands the user changed",
    () =>
      Effect.gen(function* () {
        const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
        yield* writeKeybindingsConfig(keybindingsConfigPath, [
          { key: "mod+shift+y", command: "terminal.toggle" },
          { key: "mod+shift+r", command: "script.run-tests.run" },
          { key: "mod+shift+b", command: "script.custom-panel.run" },
          {
            key: "mod+shift+b",
            command: "script.custom-composer.run",
            when: "composerFocus",
          },
          // Older builds wrote this default; a newer when clause replaced it.
          { key: "mod+1", command: "thread.jump.1", when: "isDesktop" },
        ]);
        const original = yield* (yield* FileSystem.FileSystem).readFileString(
          keybindingsConfigPath,
        );

        const keybindings = yield* Keybindings.Keybindings;
        yield* keybindings.migrateConfigOnStartup;

        const file = yield* readKeybindingsFile(keybindingsConfigPath);
        assert.equal(file.profile, "my-custom");
        assert.deepEqual(Object.keys(file.profiles), ["my-custom"]);
        assert.deepInclude(file.profiles["my-custom"], { name: "Custom", extends: "default" });
        assert.notProperty(file, "keybindings");
        assert.equal(
          yield* (yield* FileSystem.FileSystem).readFileString(
            `${keybindingsConfigPath}.pre-profiles`,
          ),
          original,
        );
        const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
        assert.deepEqual(
          persisted.map((entry) => entry.command),
          [
            "terminal.toggle",
            "script.run-tests.run",
            "script.custom-panel.run",
            "script.custom-composer.run",
          ],
        );

        const configState = yield* keybindings.loadConfigState;
        assert.deepEqual(
          commandRules(configState.keybindings, "terminal.toggle").map(
            (entry) => "shortcut" in entry && entry.shortcut.key,
          ),
          ["y"],
        );
        for (const defaultRule of SharedKeybindings.DEFAULT_KEYBINDINGS) {
          assert.isTrue(
            configState.keybindings.some((entry) => entry.command === defaultRule.command),
            `expected ${defaultRule.command}`,
          );
        }
        assert.deepEqual(
          configState.keybindings
            .filter(
              (entry) =>
                "shortcut" in entry && entry.shortcut.key === "b" && entry.shortcut.shiftKey,
            )
            .map((entry) => entry.command),
          ["threadPanel.toggle", "script.custom-panel.run", "script.custom-composer.run"],
        );
      }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("adds a late default to an existing command once", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      const when = "composerFocus && draftThreadRoute";
      const existing = { key: "mod+alt+enter", command: "composer.sendBackground", when } as const;
      const backgroundRules = Effect.map(readKeybindingsConfig(keybindingsConfigPath), (rules) =>
        rules.filter((entry) => entry.command === "composer.sendBackground"),
      );
      yield* writeKeybindingsConfig(keybindingsConfigPath, [existing]);

      yield* keybindings.migrateConfigOnStartup;
      // With the late default nothing differs from the defaults, so no profile is created.
      assert.deepEqual(yield* readKeybindingsFile(keybindingsConfigPath), {
        profile: "default",
        profiles: {},
        scripts: [],
      });
      assert.deepStrictEqual(yield* backgroundRules, []);
      assert.deepEqual(
        commandRules((yield* keybindings.loadConfigState).keybindings, "composer.sendBackground"),
        commandRules(SharedKeybindings.DEFAULT_RESOLVED_KEYBINDINGS, "composer.sendBackground"),
      );

      // Without the late default the rules still match a former default, so no profile either.
      yield* writeKeybindingsConfig(keybindingsConfigPath, [existing]);
      yield* keybindings.migrateConfigOnStartup;
      assert.deepStrictEqual(yield* backgroundRules, []);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("leaves a customized command without the late default", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      const custom = {
        key: "alt+b",
        command: "composer.sendBackground",
        when: "composerFocus && draftThreadRoute",
      } as const;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [custom]);

      yield* keybindings.migrateConfigOnStartup;
      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepStrictEqual(
        persisted.filter((entry) => entry.command === "composer.sendBackground"),
        [custom],
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("keeps a late default pending while the config is full", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      const when = "composerFocus && draftThreadRoute";
      const existing = { key: "mod+alt+enter", command: "composer.sendBackground", when } as const;
      const fillers = Array.from({ length: MAX_KEYBINDINGS_COUNT - 1 }, (_, index) => ({
        key: "mod+alt+f1",
        command: `script.filler-${index}.run` as const,
      }));
      const hasModEnter = Effect.map(keybindings.loadConfigState, ({ keybindings: rules }) =>
        commandRules(rules, "composer.sendBackground").some(
          (entry) =>
            "shortcut" in entry && entry.shortcut.key === "enter" && !entry.shortcut.altKey,
        ),
      );

      yield* writeKeybindingsConfig(keybindingsConfigPath, [existing, ...fillers]);
      yield* keybindings.migrateConfigOnStartup;
      assert.isFalse(yield* hasModEnter);

      yield* writeKeybindingsConfig(keybindingsConfigPath, [existing]);
      yield* keybindings.migrateConfigOnStartup;
      assert.isTrue(yield* hasModEnter);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("keeps unassigned defaults and unknown commands when migrating a bare array", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      const unassigned = { key: "f6", command: "workspace.focusNext", when: "false" } as const;
      const rebound = { key: "mod+g", command: "terminal.toggle" } as const;
      const fromNewerBuild = { key: "ctrl+k", command: "text.killLine", when: "editableFocus" };
      const legacy = [
        ...SharedKeybindings.DEFAULT_KEYBINDINGS.filter(
          (rule) =>
            !(rule.command === "workspace.focusNext" && rule.key === "f6") &&
            rule.command !== "terminal.toggle",
        ),
        unassigned,
        rebound,
        fromNewerBuild,
      ];
      yield* fs.writeFileString(keybindingsConfigPath, JSON.stringify(legacy));

      yield* keybindings.migrateConfigOnStartup;

      // focusNext keeps its other default, or the unassign would drop mod+f6 along with f6.
      assert.deepEqual(yield* readActiveProfileEntries(keybindingsConfigPath), [
        { key: "mod+f6", command: "workspace.focusNext" },
        unassigned,
        rebound,
        fromNewerBuild,
      ]);
      const state = yield* keybindings.loadConfigState;
      assert.deepEqual(
        commandRules(state.keybindings, "workspace.focusNext"),
        SharedKeybindings.compileResolvedKeybindingsConfig([
          { key: "mod+f6", command: "workspace.focusNext" },
          unassigned,
        ]),
      );
      assert.deepEqual(
        commandRules(state.keybindings, "terminal.toggle"),
        SharedKeybindings.compileResolvedKeybindingsConfig([rebound]),
      );
      assert.deepEqual(
        commandRules(state.keybindings, "sidebar.toggle"),
        commandRules(SharedKeybindings.DEFAULT_RESOLVED_KEYBINDINGS, "sidebar.toggle"),
      );
      assert.deepEqual(
        state.issues.map((issue) => issue.kind),
        ["keybindings.invalid-entry"],
      );

      const migrated = yield* fs.readFileString(keybindingsConfigPath);
      yield* keybindings.migrateConfigOnStartup;
      assert.equal(yield* fs.readFileString(keybindingsConfigPath), migrated);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("appends additional custom keybindings for the same command", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("replaces only the targeted custom keybinding", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+alt+r",
          command: "script.run-tests.run",
          replace: { key: "mod+r", command: "script.run-tests.run" },
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [
        { key: "mod+shift+r", command: "script.run-tests.run" },
        { key: "mod+alt+r", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("replacing with a rule that already exists elsewhere does not duplicate it", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+alt+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+alt+r",
          command: "script.run-tests.run",
          replace: { key: "mod+r", command: "script.run-tests.run" },
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [{ key: "mod+alt+r", command: "script.run-tests.run" }]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("removes only the targeted custom keybinding", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+r", command: "script.run-tests.run" },
        { key: "mod+shift+r", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.removeKeybindingRule({
          key: "mod+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedView = persisted.map(({ key, command }) => ({ key, command }));
      assert.deepEqual(persistedView, [{ key: "mod+shift+r", command: "script.run-tests.run" }]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("unassigns a shortcut without restoring it on startup and can reassign it", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      const target = SharedKeybindings.DEFAULT_KEYBINDINGS.find(
        (rule) => rule.command === "composer.sendBackground",
      )!;
      const siblings = SharedKeybindings.DEFAULT_KEYBINDINGS.filter(
        (rule) => rule.command === target.command && rule !== target,
      );
      const removed = yield* keybindings.upsertKeybindingRule({
        ...target,
        when: "false",
        replace: target,
      });
      const expected = SharedKeybindings.compileResolvedKeybindingsConfig([
        ...siblings,
        { ...target, when: "false" },
      ]);
      assert.deepEqual(
        removed.keybindings.filter((rule) => rule.command === target.command),
        expected,
      );
      yield* keybindings.migrateConfigOnStartup;
      const snapshot = yield* keybindings.getSnapshot;
      assert.deepEqual(
        snapshot.keybindings.filter((rule) => rule.command === target.command),
        expected,
      );
      yield* keybindings.upsertKeybindingRule({
        ...target,
        replace: { ...target, when: "false" },
      });
      // Back to the defaults, so the profile supplies the command again.
      assert.isFalse(
        (yield* readKeybindingsConfig(keybindingsConfigPath)).some(
          (rule) => rule.command === target.command,
        ),
      );
      yield* writeKeybindingsConfig(
        keybindingsConfigPath,
        Array.from({ length: MAX_KEYBINDINGS_COUNT }, (_, index) => ({
          key: "mod+alt+f1",
          command: `script.filler-${index}.run` as const,
        })),
      );
      assertFailure(
        yield* toDetailResult(
          keybindings.upsertKeybindingRule({ key: "mod+alt+f2", command: "script.more.run" }),
        ),
        `a profile, or the project script list, holds at most ${MAX_KEYBINDINGS_COUNT} rules`,
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("keeps entries it cannot decode when editing other keybindings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const futureCommand = { key: "mod+shift+k", command: "command.from-a-newer-build" };
      const badShortcut = { key: "mod+shift+d+o", command: "terminal.new" };
      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify([{ key: "mod+r", command: "terminal.toggle" }, futureCommand, badShortcut]),
      );
      const keybindings = yield* Keybindings.Keybindings;
      const persisted = readActiveProfileEntries(keybindingsConfigPath);

      const saved = yield* keybindings.upsertKeybindingRule({
        key: "mod+shift+r",
        command: "terminal.toggle",
      });
      assert.equal(saved.issues.length, 2);
      assert.deepEqual(yield* persisted, [
        { key: "mod+r", command: "terminal.toggle" },
        futureCommand,
        badShortcut,
        { key: "mod+shift+r", command: "terminal.toggle" },
      ]);

      const removed = yield* keybindings.removeKeybindingRule({
        key: "mod+r",
        command: "terminal.toggle",
      });
      assert.deepEqual(yield* persisted, [
        futureCommand,
        badShortcut,
        { key: "mod+shift+r", command: "terminal.toggle" },
      ]);
      const { issues } = yield* keybindings.loadConfigState;
      assert.deepEqual(removed.issues, issues);
      assert.deepEqual(
        issues.map((issue) => issue.kind === "keybindings.invalid-entry" && issue.index),
        [0, 1],
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("removes a hand-written keybinding targeted by its settings spelling", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        {
          key: "Shift+Cmd+R",
          command: "script.run-tests.run",
          when: "terminalFocus&&!previewFocus",
        },
        { key: "mod+shift+r", command: "script.run-tests.run" },
        { key: "x\u0000true", command: "script.run-tests.run" },
        { key: "x", command: "script.run-tests.run", when: "true" },
        { key: "Ctrl + X  Shift+R", command: "script.run-tests.run" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        yield* keybindings.removeKeybindingRule({
          key: "meta+shift+r",
          command: "script.run-tests.run",
          when: "terminalFocus && !previewFocus",
        });
        yield* keybindings.removeKeybindingRule({
          key: "x",
          command: "script.run-tests.run",
          when: "true",
        });
        yield* keybindings.removeKeybindingRule({
          key: "ctrl+x shift+r",
          command: "script.run-tests.run",
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepEqual(persisted, [
        { key: "mod+shift+r", command: "script.run-tests.run" },
        { key: "x\u0000true", command: "script.run-tests.run" },
      ]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("replaces a hand-written keybinding targeted by its settings spelling", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "escape", command: "script.run-tests.run", when: "a && b && c" },
      ]);
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+alt+r",
          command: "script.run-tests.run",
          replace: { key: "esc", command: "script.run-tests.run", when: "(a && b) && c" },
        });
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      assert.deepEqual(persisted, [{ key: "mod+alt+r", command: "script.run-tests.run" }]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("refuses to overwrite malformed keybindings config", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fs.writeFileString(keybindingsConfigPath, "{ not-json");

      const result = yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        return yield* keybindings.upsertKeybindingRule({
          key: "mod+shift+r",
          command: "script.run-tests.run",
        });
      }).pipe(toDetailResult);
      assertFailure(result, "expected a JSON object or array");

      const persistedRaw = yield* fs.readFileString(keybindingsConfigPath);
      assert.equal(persistedRaw, "{ not-json");
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("retries a failed config read instead of keeping the failure", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* fileSystem.makeDirectory(keybindingsConfigPath, { recursive: true });

      const keybindings = yield* Keybindings.Keybindings;
      const failed = yield* toDetailResult(keybindings.loadConfigState);
      assertFailure(failed, "failed to read keybindings config");

      yield* fileSystem.remove(keybindingsConfigPath, { recursive: true });
      yield* writeKeybindingsConfig(keybindingsConfigPath, [
        { key: "mod+j", command: "terminal.toggle" },
      ]);

      const configState = yield* keybindings.loadConfigState;
      assert.deepEqual(configState.issues, []);
      assert.isTrue(configState.keybindings.some((entry) => entry.command === "terminal.toggle"));
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("serializes concurrent upserts to avoid lost updates", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      yield* writeKeybindingsConfig(keybindingsConfigPath, []);

      const commands = Array.from(
        { length: 20 },
        (_, index): KeybindingCommand => `script.concurrent-${index}.run`,
      );
      yield* Effect.gen(function* () {
        const keybindings = yield* Keybindings.Keybindings;
        yield* Effect.forEach(
          commands,
          (command, index) =>
            keybindings.upsertKeybindingRule({
              key: `mod+${String.fromCharCode(97 + index)}`,
              command,
            }),
          { concurrency: "unbounded", discard: true },
        );
      });

      const persisted = yield* readKeybindingsConfig(keybindingsConfigPath);
      const persistedCommands = new Set(persisted.map((entry) => entry.command));
      for (const command of commands) {
        assert.isTrue(persistedCommands.has(command), `expected persisted command ${command}`);
      }
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect(
    "suppresses change emission when revalidating unchanged keybindings configuration",
    () =>
      Effect.gen(function* () {
        const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
        yield* writeKeybindingsConfig(keybindingsConfigPath, [
          { key: "mod+j", command: "terminal.toggle" },
        ]);

        const keybindings = yield* Keybindings.Keybindings;
        yield* keybindings.start;

        const changes = yield* keybindings.subscribeChanges;

        // Revalidate when config on disk has not changed (e.g. atime bump on Windows).
        // `revalidate` publishes before it returns, so a wrongly emitted event would be
        // buffered in the subscription ahead of the real change observed below.
        yield* keybindings.revalidate;

        yield* writeKeybindingsConfig(keybindingsConfigPath, [
          { key: "mod+j", command: "terminal.toggle" },
          { key: "mod+k", command: "threadPanel.toggle" },
        ]);
        yield* keybindings.revalidate;

        // The first buffered event must be the real change, not the unchanged state.
        const change = Option.getOrThrow(yield* Stream.runHead(changes));
        assert.isTrue(
          change.keybindings.some(
            (rule) =>
              rule.command === "threadPanel.toggle" &&
              "shortcut" in rule &&
              rule.shortcut.key === "k" &&
              rule.shortcut.modKey,
          ),
        );
      }).pipe(Effect.scoped, Effect.provide(layerKeybindings())),
  );

  it.effect("copies a command's defaults on its first edit and drops them once they match", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.migrateConfigOnStartup;

      yield* keybindings.upsertKeybindingRule({ key: "ctrl+g", command: "terminal.toggle" });
      assert.deepEqual(yield* readKeybindingsConfig(keybindingsConfigPath), [
        { key: "mod+j", command: "terminal.toggle" },
        { key: "ctrl+g", command: "terminal.toggle" },
      ]);

      yield* keybindings.removeKeybindingRule({ key: "ctrl+g", command: "terminal.toggle" });
      assert.deepEqual(yield* readKeybindingsConfig(keybindingsConfigPath), []);

      // Removing the last inherited rule must not let the profile hand it back.
      yield* keybindings.removeKeybindingRule({ key: "mod+j", command: "terminal.toggle" });
      assert.deepEqual(yield* readKeybindingsConfig(keybindingsConfigPath), [
        { key: "mod+j", command: "terminal.toggle", when: "false" },
      ]);
      // Only the first edit copied the built-in; the rest stayed in that copy.
      const file = yield* readKeybindingsFile(keybindingsConfigPath);
      assert.equal(file.profile, "my-default-copy");
      assert.deepEqual(Object.keys(file.profiles), ["my-default-copy"]);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("copies a built-in profile on every edit made while it is active", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.migrateConfigOnStartup;
      const profileOf = (state: Keybindings.KeybindingsConfigState) =>
        state.keybindingProfiles.find(({ id }) => id === state.activeKeybindingProfile);

      const upserted = yield* keybindings.upsertKeybindingRule({
        key: "mod+g",
        command: "terminal.toggle",
      });
      assert.deepInclude(profileOf(upserted), {
        id: "my-default-copy",
        name: "Default copy",
        builtIn: false,
        extends: "default",
      });

      yield* keybindings.mutateProfile({ type: "select", profileId: "default" });
      const removed = yield* keybindings.removeKeybindingRule({
        key: "mod+j",
        command: "terminal.toggle",
      });
      assert.deepInclude(profileOf(removed), { id: "my-default-copy-2", name: "Default copy 2" });

      // Edits that leave nothing to keep create no copy.
      yield* keybindings.mutateProfile({ type: "select", profileId: "default" });
      const reset = yield* keybindings.upsertKeybindingRule({
        key: "mod+j",
        command: "terminal.toggle",
        replace: { key: "mod+j", command: "terminal.toggle" },
      });
      assert.equal(reset.activeKeybindingProfile, "default");
      const missing = yield* keybindings.removeKeybindingRule({
        key: "mod+alt+q",
        command: "terminal.toggle",
      });
      assert.equal(missing.activeKeybindingProfile, "default");

      yield* keybindings.upsertKeybindingRule({ key: "mod+shift+g", command: "terminal.toggle" });
      const file = yield* readKeybindingsFile(keybindingsConfigPath);
      assert.deepEqual(Object.keys(file.profiles), [
        "my-default-copy",
        "my-default-copy-2",
        "my-default-copy-3",
      ]);
      assert.deepEqual(
        file.profiles["my-default-copy-3"].keybindings.map((rule: KeybindingRule) => rule.key),
        ["mod+j", "mod+shift+g"],
      );

      const builtIn = yield* keybindings.mutateProfile({ type: "select", profileId: "default" });
      assert.deepEqual(builtIn.keybindings, SharedKeybindings.DEFAULT_RESOLVED_KEYBINDINGS);
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("keeps project script shortcuts outside profiles", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.migrateConfigOnStartup;
      const script = { key: "mod+shift+r", command: "script.test.run" } as const;

      const saved = yield* keybindings.upsertKeybindingRule({
        ...script,
        profile: { profileId: "my-copy", copyOf: { extends: "default", name: "Default copy" } },
      });
      assert.equal(saved.activeKeybindingProfile, "default");
      const file = yield* readKeybindingsFile(keybindingsConfigPath);
      assert.deepEqual(file.profiles, {});
      assert.deepEqual(file.scripts, [script]);

      const switched = yield* keybindings.mutateProfile({
        type: "create",
        id: "my-keys",
        name: "Mine",
        extends: "default",
      });
      assert.deepEqual(
        commandRules(switched.keybindings, "script.test.run"),
        SharedKeybindings.compileResolvedKeybindingsConfig([script]),
      );

      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify({ scripts: [script, { key: "mod+g", command: "terminal.toggle" }] }),
      );
      yield* keybindings.revalidate;
      const state = yield* keybindings.loadConfigState;
      assert.deepEqual(
        state.issues.map((issue) => issue.kind === "keybindings.invalid-entry" && issue.index),
        [1],
      );
      assert.deepEqual(
        commandRules(state.keybindings, "terminal.toggle"),
        commandRules(SharedKeybindings.DEFAULT_RESOLVED_KEYBINDINGS, "terminal.toggle"),
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("creates a profile that starts from no shortcuts", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.migrateConfigOnStartup;

      const empty = yield* keybindings.mutateProfile({
        type: "create",
        id: "my-empty",
        name: "Empty",
        extends: null,
      });
      assert.deepEqual(empty.keybindings, []);
      assert.deepInclude(empty.keybindingProfiles.at(-1), { id: "my-empty", extends: null });

      const edited = yield* keybindings.upsertKeybindingRule({
        key: "mod+g",
        command: "terminal.toggle",
        profile: { profileId: "my-empty" },
      });
      assert.deepEqual(
        edited.keybindings,
        SharedKeybindings.compileResolvedKeybindingsConfig([
          { key: "mod+g", command: "terminal.toggle" },
        ]),
      );
      assert.deepEqual((yield* readKeybindingsFile(keybindingsConfigPath)).profiles, {
        "my-empty": {
          name: "Empty",
          extends: null,
          keybindings: [{ key: "mod+g", command: "terminal.toggle" }],
        },
      });

      const deleted = yield* keybindings.mutateProfile({ type: "delete", profileId: "my-empty" });
      assert.equal(deleted.activeKeybindingProfile, "default");
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("edits custom profiles against what they inherit", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.migrateConfigOnStartup;
      const sidebarKeys = (state: Keybindings.KeybindingsConfigState) =>
        commandRules(state.keybindings, "sidebar.toggle").map(
          (rule) => "shortcut" in rule && rule.shortcut.key,
        );
      const detail = (mutation: Parameters<typeof keybindings.mutateProfile>[0]) =>
        toDetailResult(keybindings.mutateProfile(mutation));

      const created = yield* keybindings.mutateProfile({
        type: "create",
        id: "my-keys",
        name: "My Keys!",
        extends: "default",
      });
      assert.equal(created.activeKeybindingProfile, "my-keys");
      assert.deepEqual(
        created.keybindingProfiles.map(({ id, builtIn }) => [id, builtIn]),
        [
          ["default", true],
          ["my-keys", false],
        ],
      );
      const edited = yield* keybindings.upsertKeybindingRule({
        key: "ctrl+alt+b",
        command: "sidebar.toggle",
        replace: { key: "mod+b", command: "sidebar.toggle" },
        profile: { profileId: "my-keys" },
      });
      assert.deepEqual(sidebarKeys(edited), ["b"]);

      const child = { type: "create", id: "my-keys-2", extends: "my-keys" } as const;
      assertFailure(
        yield* detail({ ...child, name: "My Keys!" }),
        'a profile named "My Keys!" already exists',
      );
      assertFailure(
        yield* detail({ ...child, id: "my-keys", name: "Other" }),
        'a profile with the id "my-keys" already exists',
      );
      yield* keybindings.mutateProfile({ ...child, name: "My Keys! 2" });
      yield* keybindings.upsertKeybindingRule({ key: "mod+shift+b", command: "sidebar.toggle" });
      // Back to what my-keys binds, so my-keys-2 no longer holds the command.
      yield* keybindings.removeKeybindingRule({ key: "mod+shift+b", command: "sidebar.toggle" });
      const file = yield* readKeybindingsFile(keybindingsConfigPath);
      assert.deepEqual(file.profiles, {
        "my-keys": {
          name: "My Keys!",
          extends: "default",
          keybindings: [{ key: "ctrl+alt+b", command: "sidebar.toggle" }],
        },
        "my-keys-2": { name: "My Keys! 2", extends: "my-keys", keybindings: [] },
      });

      const switched = yield* keybindings.mutateProfile({ type: "select", profileId: "default" });
      assert.deepEqual(
        commandRules(switched.keybindings, "sidebar.toggle"),
        commandRules(SharedKeybindings.DEFAULT_RESOLVED_KEYBINDINGS, "sidebar.toggle"),
      );

      yield* keybindings.mutateProfile({ type: "select", profileId: "my-keys-2" });
      assertFailure(
        yield* detail({ type: "rename", profileId: "my-keys-2", name: "Default" }),
        'a profile named "Default" already exists',
      );
      const renamed = yield* keybindings.mutateProfile({
        type: "rename",
        profileId: "my-keys-2",
        name: "Mine",
      });
      assert.equal(
        renamed.keybindingProfiles.find((profile) => profile.id === "my-keys-2")?.name,
        "Mine",
      );
      const deleted = yield* keybindings.mutateProfile({ type: "delete", profileId: "my-keys-2" });
      assert.equal(deleted.activeKeybindingProfile, "my-keys");
      assert.deepEqual(
        deleted.keybindingProfiles.map(({ id }) => id),
        ["default", "my-keys"],
      );

      let parent = "my-keys";
      for (let depth = 3; depth <= 8; ++depth) {
        const id = `my-depth-${depth}`;
        yield* keybindings.mutateProfile({ type: "create", id, name: id, extends: parent });
        parent = id;
      }
      assertFailure(
        yield* detail({ type: "create", id: "my-depth-9", name: "Deep", extends: parent }),
        'profile "my-depth-9" extends too many profiles',
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("applies an edit only to the profile it was made under", () =>
    Effect.gen(function* () {
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* keybindings.migrateConfigOnStartup;
      const edit = { key: "mod+g", command: "terminal.toggle" } as const;
      const copy = { profileId: "my-copy", copyOf: { extends: "default", name: "Standardkopie" } };

      // An edit that changes nothing creates no copy.
      const reset = yield* keybindings.upsertKeybindingRule({
        key: "mod+j",
        command: "terminal.toggle",
        replace: { key: "mod+j", command: "terminal.toggle" },
        profile: copy,
      });
      assert.equal(reset.activeKeybindingProfile, "default");

      const created = yield* keybindings.upsertKeybindingRule({ ...edit, profile: copy });
      assert.deepInclude(
        created.keybindingProfiles.find(({ id }) => id === created.activeKeybindingProfile),
        { id: "my-copy", name: "Standardkopie", extends: "default" },
      );
      // Sent again, as when the client fans out to a machine that already applied it.
      yield* keybindings.upsertKeybindingRule({ ...edit, profile: { profileId: "my-copy" } });

      assertFailure(
        yield* toDetailResult(
          keybindings.upsertKeybindingRule({ ...edit, profile: { profileId: "my-other" } }),
        ),
        'profile "my-copy" is active here, not "my-other"',
      );
      yield* keybindings.mutateProfile({ type: "select", profileId: "default" });
      assertFailure(
        yield* toDetailResult(
          keybindings.removeKeybindingRule({
            ...edit,
            profile: { profileId: "my-copy-2", copyOf: { extends: "emacs", name: "Emacs copy" } },
          }),
        ),
        'profile "default" is active here, not "emacs"',
      );
      assertFailure(
        yield* toDetailResult(keybindings.upsertKeybindingRule({ ...edit, profile: copy })),
        'a profile with the id "my-copy" already exists',
      );
      assert.deepEqual(
        (yield* readKeybindingsFile(keybindingsConfigPath)).profiles["my-copy"].keybindings,
        [
          { key: "mod+j", command: "terminal.toggle" },
          { key: "mod+g", command: "terminal.toggle" },
        ],
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("edits a hand-written profile that extends a built-in", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify({
          profile: "hugo",
          profiles: {
            hugo: {
              name: "Hugo",
              extends: "default",
              keybindings: [{ key: "ctrl+alt+b", command: "sidebar.toggle" }],
            },
          },
        }),
      );
      const parent = yield* keybindings.mutateProfile({ type: "select", profileId: "default" });
      yield* keybindings.mutateProfile({ type: "select", profileId: "hugo" });

      const edited = yield* keybindings.upsertKeybindingRule({
        key: "mod+g",
        command: "terminal.toggle",
        profile: { profileId: "hugo" },
      });
      assert.equal(edited.activeKeybindingProfile, "hugo");
      assert.deepEqual(
        commandRules(edited.keybindings, "chat.new"),
        commandRules(parent.keybindings, "chat.new"),
      );
      const file = yield* readKeybindingsFile(keybindingsConfigPath);
      assert.deepEqual(Object.keys(file.profiles), ["hugo"]);
      assert.deepEqual(
        file.profiles.hugo.keybindings.map((rule: KeybindingRule) => rule.command),
        [
          "sidebar.toggle",
          ...commandRules(parent.keybindings, "terminal.toggle").map(() => "terminal.toggle"),
          "terminal.toggle",
        ],
      );
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("moves top-level rules into a profile extending the active one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify({
          profile: "custom",
          profiles: {
            custom: {
              name: "Custom",
              keybindings: [{ key: "ctrl+b", command: "sidebar.toggle" }],
            },
          },
          keybindings: [
            { key: "ctrl+b", command: "sidebar.toggle" },
            { key: "mod+g", command: "terminal.toggle" },
          ],
        }),
      );

      yield* keybindings.migrateConfigOnStartup;
      const file = yield* readKeybindingsFile(keybindingsConfigPath);
      assert.notProperty(file, "keybindings");
      assert.equal(file.profile, "my-custom-2");
      assert.deepEqual(file.profiles["my-custom-2"], {
        name: "Custom 2",
        extends: "custom",
        keybindings: [{ key: "mod+g", command: "terminal.toggle" }],
      });
    }).pipe(Effect.provide(layerKeybindings())),
  );

  it.effect("guards profile changes and falls back when the active profile cannot resolve", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { keybindingsConfigPath } = yield* ServerConfig.ServerConfig;
      const keybindings = yield* Keybindings.Keybindings;
      yield* fs.writeFileString(
        keybindingsConfigPath,
        JSON.stringify({
          profile: "a",
          profiles: [
            { id: "a", name: "A", extends: "b", keybindings: [] },
            { id: "b", name: "B", extends: "a", keybindings: [] },
            {
              id: "default",
              name: "Hijack",
              keybindings: [{ key: "x", command: "sidebar.toggle" }],
            },
            { id: "c", name: "C", extends: "default", keybindings: [] },
            { id: "d", name: "D", extends: "c", keybindings: [] },
          ],
          keybindings: [],
          futureKey: { kept: true },
        }),
      );

      const state = yield* keybindings.loadConfigState;
      assert.equal(state.activeKeybindingProfile, "default");
      assert.deepEqual(state.keybindings, SharedKeybindings.DEFAULT_RESOLVED_KEYBINDINGS);
      assert.deepEqual(
        state.issues.map((issue) => issue.kind),
        ["keybindings.invalid-entry", "keybindings.malformed-config"],
      );

      const detail = (mutation: Parameters<typeof keybindings.mutateProfile>[0]) =>
        toDetailResult(keybindings.mutateProfile(mutation));
      assertFailure(
        yield* detail({ type: "select", profileId: "a" }),
        'profile "a" extends itself through "a"',
      );
      assertFailure(
        yield* detail({ type: "select", profileId: "missing" }),
        'unknown keybinding profile "missing"',
      );
      assertFailure(
        yield* detail({ type: "rename", profileId: "default", name: "X" }),
        '"default" is a built-in profile',
      );
      assertFailure(yield* detail({ type: "delete", profileId: "c" }), 'profile "d" extends "c"');

      const edit = { key: "mod+g", command: "terminal.toggle" } as const;
      const refusal = 'profile "a" extends itself through "a"; select another profile to edit';
      assertFailure(yield* toDetailResult(keybindings.upsertKeybindingRule(edit)), refusal);
      assertFailure(yield* toDetailResult(keybindings.removeKeybindingRule(edit)), refusal);
      assert.equal((yield* readKeybindingsFile(keybindingsConfigPath)).profile, "a");

      yield* keybindings.mutateProfile({ type: "select", profileId: "d" });
      const file = yield* readKeybindingsFile(keybindingsConfigPath);
      assert.equal(file.profile, "d");
      assert.deepEqual(file.futureKey, { kept: true });
      // Read from the array form of early builds, and written back keyed by id.
      assert.deepEqual(Object.keys(file.profiles), ["a", "b", "default", "c", "d"]);
    }).pipe(Effect.provide(layerKeybindings())),
  );
});
