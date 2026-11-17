import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import { ForwardCompatibleArray } from "./baseSchemas.ts";
import {
  KeybindingCommand,
  KeybindingShortcut,
  KeybindingWhenNode,
  ResolvedKeybindingsConfig,
} from "./keybindings.ts";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

const shortcut = {
  key: "p",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: true,
};

it.effect("drops resolved rules with commands this build does not know", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      { command: "terminal.toggle", shortcut },
      { command: "someFuture.toggle", shortcut },
      { command: "filePicker.toggle", shortcut },
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle", "filePicker.toggle"],
    );
  }),
);

it.effect("round-trips resolved Space shortcuts", () =>
  Effect.gen(function* () {
    const codec = Schema.fromJsonString(ResolvedKeybindingsConfig);
    const rules = [
      {
        command: "composer.dictation" as const,
        shortcut: { ...shortcut, key: " ", metaKey: true, modKey: false },
      },
    ];
    const encoded = yield* Schema.encodeEffect(codec)(rules);
    const parsed = yield* decode(codec, encoded);
    assert.deepEqual(parsed, rules);
  }),
);

it.effect("drops malformed resolved rule entries", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      "garbage",
      { command: "terminal.toggle", shortcut },
      null,
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle"],
    );
  }),
);

it.effect("keeps key sequences away from clients that only know single chords", () =>
  Effect.gen(function* () {
    const codec = Schema.fromJsonString(ResolvedKeybindingsConfig);
    const rules = [
      { command: "terminal.toggle" as const, shortcut },
      { command: "filePicker.toggle" as const, sequence: [shortcut, { ...shortcut, key: "f" }] },
    ];
    const encoded = yield* Schema.encodeEffect(codec)(rules);
    assert.deepEqual(yield* decode(codec, encoded), rules);

    // The rule shape before key sequences existed.
    const singleChordClient = ForwardCompatibleArray(
      Schema.Struct({
        command: KeybindingCommand,
        shortcut: KeybindingShortcut,
        whenAst: Schema.optional(KeybindingWhenNode),
      }).annotate({ parseOptions: { onExcessProperty: "ignore" } }),
    );
    const parsed = yield* decode(Schema.fromJsonString(singleChordClient), encoded);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["terminal.toggle"],
    );
  }),
);

it.effect("drops a sequence with one step or too many", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      { command: "terminal.toggle", sequence: [shortcut] },
      { command: "terminal.toggle", sequence: Array.from({ length: 5 }, () => shortcut) },
      { command: "filePicker.toggle", sequence: [shortcut, shortcut] },
    ]);
    assert.deepEqual(
      parsed.map((rule) => rule.command),
      ["filePicker.toggle"],
    );
  }),
);
