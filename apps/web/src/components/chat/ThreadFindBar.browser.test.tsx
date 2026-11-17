import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  return {
    ...actual,
    primaryServerKeybindingsAtom: Atom.make(
      compileResolvedKeybindingsConfig([
        { key: "ctrl+s", command: "chat.findNext" },
        { key: "ctrl+r", command: "chat.findPrevious" },
      ]),
    ),
  };
});

import { registerCommands } from "../../shortcuts/dispatcher";
import { ThreadFindBar } from "./ThreadFindBar";

describe("ThreadFindBar", () => {
  it("steps through matches on find next and previous while its field has focus", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const reopen = vi.fn();
    using _chatView = {
      [Symbol.dispose]: registerCommands({ "chat.findNext": reopen, "chat.findPrevious": reopen }),
    };
    await using _screen = await render(
      <ThreadFindBar
        open
        query="foo"
        matchCount={3}
        status={null}
        onRetry={() => undefined}
        activeIndex={0}
        navigationId={1}
        settled
        focusRequestId={1}
        onQueryChange={() => undefined}
        onNext={onNext}
        onPrevious={onPrevious}
        onClose={() => undefined}
      />,
      { router: false },
    );

    await userEvent.keyboard("{Control>}s{/Control}");
    await userEvent.keyboard("{Control>}r{/Control}");

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(reopen).not.toHaveBeenCalled();
  });
});
