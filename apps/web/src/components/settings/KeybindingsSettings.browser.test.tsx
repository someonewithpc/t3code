import { RegistryProvider } from "@effect/atom-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent, type Locator } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import * as atomCommands from "../../state/use-atom-command";

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: ((environments: ReadonlyArray<{ environmentId: string }>) =>
    new Set(environments.map(({ environmentId }) => environmentId))) as never,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: vi.fn(() => vi.fn()) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => {
    const environment = {
      environmentId: "env",
      label: "Build workstation",
      serverConfig: {
        keybindings: compileResolvedKeybindingsConfig([
          { command: "composer.sendBackground", key: "mod+alt+enter", when: "false" },
        ]),
        keybindingsConfigPath: null,
        availableEditors: [],
      },
    };
    return {
      scope: { kind: "environment" },
      environment,
      environments: [environment],
      connectedEnvironments: [environment],
      targets: [],
      target: null,
    };
  }) as never,
}));

import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { KeybindingsSettingsPanel } from "./KeybindingsSettings";

// The modal dialog's inert layer swallows pointer events in this harness, so drive the DOM.
async function activate(locator: Locator, action: "click" | "focus") {
  await expect.element(locator).toBeVisible();
  (locator.element() as HTMLElement)[action]();
}

const existingPill = page.getByRole("button", { name: /^Edit shortcut for Sidebar: Toggle:/ });
const newField = page.getByRole("textbox", { name: "Keybinding for new keybinding" });

describe("Esc in a shortcut recorder", () => {
  it.each<{
    name: string;
    label: string;
    open: () => Promise<void>;
    expectReset: () => Promise<void>;
  }>([
    {
      name: "existing binding",
      label: "Sidebar: Toggle",
      open: () => activate(existingPill, "click"),
      expectReset: async () => {
        await expect.element(existingPill).toHaveFocus();
        await expect.element(page.getByRole("button", { name: "Save" })).not.toBeInTheDocument();
      },
    },
    {
      name: "new binding",
      label: "new keybinding",
      open: async () => {
        await activate(page.getByRole("button", { name: "Add keybinding" }), "click");
        await activate(newField, "focus");
      },
      expectReset: async () => {
        await expect.element(newField).toHaveValue("");
        await expect.element(newField).toHaveAttribute("placeholder", "Unassigned");
      },
    },
  ])("leaves the $name field without closing Settings", async ({ label, open, expectReset }) => {
    const onOpenChange = vi.fn();
    await using _screen = await render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogPopup>
          <DialogTitle>Settings</DialogTitle>
          <KeybindingsSettingsPanel />
        </DialogPopup>
      </Dialog>,
    );
    const addStep = page.getByRole("button", {
      name: `Add a key to the shortcut for ${label}`,
      exact: true,
    });
    const nextStep = page.getByRole("textbox", { name: `Key 2 of the shortcut for ${label}` });

    await open();
    await userEvent.keyboard("{Control>}k{/Control}");
    await expect.element(addStep).toHaveFocus();

    // Esc while recording a later step drops only that step.
    await userEvent.keyboard("{Enter}");
    await expect.element(nextStep).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(addStep).toHaveFocus();
    await expect
      .element(
        page.getByRole("button", { name: `Change key 1 of the shortcut for ${label}: Ctrl+K` }),
      )
      .toBeVisible();

    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.activeElement?.matches("[data-keybinding-capture]")).toBe(false);
    await expectReset();

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});

it("records a sequence one step at a time and saves it whole", async () => {
  const mutate = vi.fn(async () => ({ _tag: "Success", value: [] }));
  await vi.mocked(atomCommands.useAtomCommand).withImplementation(
    () => mutate as never,
    async () => {
      await using screen = await render(<KeybindingsSettingsPanel />);
      const addStep = screen.getByRole("button", {
        name: "Add a key to the shortcut for Sidebar: Toggle",
        exact: true,
      });
      const removeStep = (index: number, key: string) =>
        screen.getByRole("button", {
          name: `Remove key ${index} (${key}) from the shortcut for Sidebar: Toggle`,
        });

      await addStep.click();
      await userEvent.keyboard("{Control>}x{/Control}");
      await expect.element(addStep).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      // Keys that could end a recording elsewhere are steps like any other.
      await userEvent.keyboard("{Backspace}");
      await expect.element(addStep).toHaveFocus();

      await removeStep(2, "Ctrl+X").click();
      await expect.element(removeStep(2, "Backspace")).toHaveFocus();
      await removeStep(2, "Backspace").click();
      await expect.element(existingPill).toHaveFocus();

      await addStep.click();
      await userEvent.keyboard("{Control>}x{/Control}");
      await addStep.click();
      await userEvent.keyboard("{Control>}x{/Control}");
      await screen.getByRole("button", { name: "Save" }).click();
      expect(mutate).toHaveBeenLastCalledWith({
        environmentId: "env",
        input: expect.objectContaining({
          command: "sidebar.toggle",
          key: "mod+b mod+x mod+x",
          replace: { command: "sidebar.toggle", key: "mod+b" },
        }),
      });
    },
  );
});

it("unassigns a default shortcut and restores its condition when one is assigned again", async () => {
  const mutate = vi.fn(async () => ({ _tag: "Success", value: [] }));
  await vi.mocked(atomCommands.useAtomCommand).withImplementation(
    () => mutate as never,
    async () => {
      await using screen = await render(<KeybindingsSettingsPanel />);

      await screen.getByRole("button", { name: "Actions for Sidebar: Toggle" }).click();
      await screen.getByRole("menuitem", { name: "Unassign" }).click();
      expect(mutate).toHaveBeenLastCalledWith({
        environmentId: "env",
        input: {
          command: "sidebar.toggle",
          key: "mod+b",
          when: "false",
          replace: { command: "sidebar.toggle", key: "mod+b" },
        },
      });

      const unassigned = screen.getByRole("button", {
        name: "Edit shortcut for Composer: Start in Background: Unassigned",
      });
      const save = screen.getByRole("button", { name: "Save" });
      await unassigned.click();
      await userEvent.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");
      await expect.element(save).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await expect.element(save).not.toBeInTheDocument();

      await unassigned.click();
      await userEvent.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");
      await save.click();
      expect(mutate).toHaveBeenLastCalledWith({
        environmentId: "env",
        input: expect.objectContaining({
          command: "composer.sendBackground",
          when: "composerFocus && draftThreadRoute",
          replace: { command: "composer.sendBackground", key: "mod+alt+enter", when: "false" },
        }),
      });
    },
  );
});

it("Esc in the keybindings search clears the query without closing Settings", async () => {
  const onOpenChange = vi.fn();
  await using _screen = await render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogTitle>Settings</DialogTitle>
        <KeybindingsSettingsPanel />
      </DialogPopup>
    </Dialog>,
  );
  const search = page.getByRole("searchbox", { name: "Search keybindings" });
  await search.fill("sidebar");

  await userEvent.keyboard("{Escape}");

  await expect.element(search).toHaveValue("");
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("re-enables Save when a When editor closes on an expression it could not parse", async () => {
  await using screen = await render(
    <RegistryProvider>
      <KeybindingsSettingsPanel />
    </RegistryProvider>,
  );
  const whenTrigger = screen.getByRole("button", { name: "Edit when clause for Terminal: Toggle" });
  const expression = screen.getByRole("textbox", { name: "When expression" });

  await whenTrigger.click();
  await userEvent.type(expression, "terminalFocus");
  await userEvent.type(expression, " &&");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await userEvent.keyboard("{Escape}");
  await whenTrigger.click();

  await expect.element(expression).toHaveValue("terminalFocus");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});
