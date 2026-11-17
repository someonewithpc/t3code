import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveShortcutCommand } from "../keybindings";
import {
  dispatchMenuAction,
  registerCommands,
  registerMenuAction,
  registerShortcutContext,
} from "./dispatcher";

function bindings(entries: ReadonlyArray<[string, KeybindingCommand]>): ResolvedKeybindingsConfig {
  return entries.map(([key, command]) => ({
    command,
    shortcut: {
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: false,
    },
  }));
}

const keybindings = () =>
  bindings([
    ["k", "chat.new"],
    ["j", "chat.newLocal"],
  ]);

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}

describe("command dispatcher", () => {
  it("runs the newest scope's handler and nothing below it", () => {
    const global = vi.fn();
    const outer = vi.fn();
    const inner = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": global }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": outer }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": inner }, { keybindings }));

    press("k");

    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it("falls through scopes that return false, skip the command, or fail their guard", () => {
    const global = vi.fn();
    const declined = vi.fn(() => false);
    const guarded = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": global }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": declined }, { keybindings }));
    stack.defer(registerCommands({ "chat.newLocal": vi.fn() }, { keybindings }));
    stack.defer(registerCommands({ "chat.new": guarded }, { keybindings, when: () => false }));

    press("k");

    expect(guarded).not.toHaveBeenCalled();
    expect(declined).toHaveBeenCalledOnce();
    expect(global).toHaveBeenCalledOnce();
  });

  it("stops once a handler prevents default, and unregisters on cleanup", () => {
    const lower = vi.fn();
    const upper = vi.fn((event: KeyboardEvent) => {
      event.preventDefault();
      return false;
    });
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": lower }, { keybindings }));
    const unregisterUpper = registerCommands({ "chat.new": upper }, { keybindings });

    press("k");
    expect(lower).not.toHaveBeenCalled();

    unregisterUpper();
    press("k");
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).toHaveBeenCalledOnce();
  });

  it("lets a scope claim raw keys before command lookup", () => {
    const onEscape = vi.fn((event: KeyboardEvent) => (event.key === "Escape" ? undefined : false));
    const command = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": command }, { keybindings, onKeyDown: onEscape }));

    press("Escape");
    press("k");

    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenCalledOnce();
  });

  it("tells observers whether a scope consumed the key, after the scopes ran", () => {
    const calls: Array<string> = [];
    using stack = new DisposableStack();
    stack.defer(
      registerCommands({}, { observe: (_event, consumed) => calls.push(`observe:${consumed}`) }),
    );
    stack.defer(
      registerCommands({ "chat.new": () => void calls.push("command") }, { keybindings }),
    );

    press("k");
    press("x");

    expect(calls).toEqual(["command", "observe:true", "observe:false"]);
  });

  it("consumes a command chord pressed inside a confirmation without running its handler", () => {
    const command = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    const cancel = document.createElement("button");
    dialog.append(cancel);
    document.body.append(dialog);
    using stack = new DisposableStack();
    stack.defer(() => dialog.remove());
    stack.defer(registerCommands({ "chat.new": command }, { keybindings }));
    cancel.focus();

    const event = new KeyboardEvent("keydown", { key: "k", cancelable: true, bubbles: true });
    cancel.dispatchEvent(event);

    expect(command).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("routes a menu action to its newest handler", () => {
    const older = vi.fn();
    const newer = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerMenuAction("test-action", older));
    const unregisterNewer = registerMenuAction("test-action", newer);

    dispatchMenuAction("test-action");
    unregisterNewer();
    dispatchMenuAction("test-action");

    expect(newer).toHaveBeenCalledOnce();
    expect(older).toHaveBeenCalledOnce();
  });
});

function pressKey(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const ctrlX = { key: "x", code: "KeyX", ctrlKey: true };

const sequenceKeybindings = () =>
  compileResolvedKeybindingsConfig([
    { key: "ctrl+x h", command: "chat.new" },
    { key: "ctrl+x ctrl+x", command: "chat.newLocal" },
    { key: "ctrl+x", command: "sidebar.toggle" },
    { key: "ctrl+x c", command: "chat.find", when: "composerFocus" },
  ]);

describe("key sequences", () => {
  it("consumes every key of a sequence and runs its command once, in and out of scopes", () => {
    const command = vi.fn();
    const shadowed = vi.fn();
    const resolvedOutside: Array<KeybindingCommand | null> = [];
    const outsideListener = (event: KeyboardEvent) => {
      resolvedOutside.push(resolveShortcutCommand(event, sequenceKeybindings()));
    };
    using stack = new DisposableStack();
    stack.defer(
      registerCommands(
        { "chat.new": command, "sidebar.toggle": shadowed },
        { keybindings: sequenceKeybindings },
      ),
    );
    window.addEventListener("keydown", outsideListener);
    stack.defer(() => window.removeEventListener("keydown", outsideListener));

    expect(pressKey(ctrlX).defaultPrevented).toBe(true);
    expect(pressKey({ key: "h", code: "KeyH" }).defaultPrevented).toBe(true);

    expect(command).toHaveBeenCalledOnce();
    expect(command.mock.calls[0]?.[0].key).toBe("Unidentified");
    expect(shadowed).not.toHaveBeenCalled();
    expect(resolvedOutside).toEqual(["chat.new"]);
    expect(pressKey({ key: "h", code: "KeyH" }).defaultPrevented).toBe(false);
  });

  it("routes the final command to a capture scope and swallows key repeats", () => {
    const command = vi.fn();
    using stack = new DisposableStack();
    stack.defer(
      registerCommands(
        { "chat.newLocal": command },
        { keybindings: sequenceKeybindings, capture: true },
      ),
    );

    pressKey(ctrlX);
    expect(pressKey({ ...ctrlX, repeat: true }).defaultPrevented).toBe(true);
    expect(command).not.toHaveBeenCalled();
    pressKey(ctrlX);

    expect(command).toHaveBeenCalledOnce();
  });

  it("swallows an undefined key, cancels on Escape, and lets modifier keys through", () => {
    const command = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.new": command }, { keybindings: sequenceKeybindings }));

    pressKey(ctrlX);
    expect(pressKey({ key: "Shift", code: "ShiftLeft", shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(pressKey({ key: "z", code: "KeyZ" }).defaultPrevented).toBe(true);
    expect(pressKey({ key: "h", code: "KeyH" }).defaultPrevented).toBe(false);

    pressKey(ctrlX);
    expect(pressKey({ key: "Escape", code: "Escape" }).defaultPrevented).toBe(true);
    expect(pressKey({ key: "h", code: "KeyH" }).defaultPrevented).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });

  it("cancels on pointerdown and focus changes, and leaves the shortcut recorder alone", () => {
    const command = vi.fn();
    const button = document.createElement("button");
    const recorder = document.createElement("input");
    recorder.setAttribute("data-keybinding-capture", "");
    document.body.append(button, recorder);
    using stack = new DisposableStack();
    stack.defer(() => {
      button.remove();
      recorder.remove();
    });
    stack.defer(registerCommands({ "chat.new": command }, { keybindings: sequenceKeybindings }));

    pressKey(ctrlX);
    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(pressKey({ key: "h", code: "KeyH" }).defaultPrevented).toBe(false);

    pressKey(ctrlX);
    button.focus();
    expect(pressKey({ key: "h", code: "KeyH" }, button).defaultPrevented).toBe(false);

    recorder.focus();
    expect(pressKey(ctrlX, recorder).defaultPrevented).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });

  it("reads when-clause context registered outside the dispatcher", () => {
    const command = vi.fn();
    using stack = new DisposableStack();
    stack.defer(registerCommands({ "chat.find": command }, { keybindings: sequenceKeybindings }));

    pressKey(ctrlX);
    pressKey({ key: "c", code: "KeyC" });
    expect(command).not.toHaveBeenCalled();

    stack.defer(registerShortcutContext(() => ({ composerFocus: true })));
    pressKey(ctrlX);
    pressKey({ key: "c", code: "KeyC" });
    expect(command).toHaveBeenCalledOnce();
  });
});
