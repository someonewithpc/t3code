import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  return {
    ...actual,
    primaryServerKeybindingsAtom: Atom.make(
      compileResolvedKeybindingsConfig([
        { key: "ctrl+space", command: "text.anchorSelection" },
        { key: "ctrl+g", command: "text.clearSelection" },
      ]),
    ),
  };
});

import { installTextEditingCommands } from "./commands";

function setup() {
  const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  const uninstall = installTextEditingCommands();
  const field = document.createElement("textarea");
  field.value = "foo bar\nbaz qux";
  document.body.append(field);
  field.focus();
  field.setSelectionRange(5, 5);
  return {
    field,
    [Symbol.dispose]() {
      field.remove();
      uninstall();
      platform.mockRestore();
    },
  };
}

describe("text editing commands", () => {
  it("extends an anchored selection with the arrow keys", async () => {
    using test = setup();
    await userEvent.keyboard("{Control>} {/Control}{ArrowLeft}{ArrowLeft}");
    expect([test.field.selectionStart, test.field.selectionEnd]).toEqual([3, 5]);

    await userEvent.keyboard("{ArrowDown}{End}");
    expect([test.field.selectionStart, test.field.selectionEnd]).toEqual([5, 15]);
  });

  it("extends an anchored selection with the word and document motions", async () => {
    using test = setup();
    await userEvent.keyboard("{Control>} {/Control}{Alt>}{ArrowLeft}{/Alt}");
    expect([test.field.selectionStart, test.field.selectionEnd]).toEqual([4, 5]);

    await userEvent.keyboard("{Control>}{End}{/Control}");
    expect([test.field.selectionStart, test.field.selectionEnd]).toEqual([5, 15]);
  });

  it("leaves the arrow keys alone once the selection is cleared", async () => {
    using test = setup();
    await userEvent.keyboard("{Control>} {/Control}{ArrowLeft}{Control>}g{/Control}{ArrowLeft}");
    expect([test.field.selectionStart, test.field.selectionEnd]).toEqual([3, 3]);
  });
});
