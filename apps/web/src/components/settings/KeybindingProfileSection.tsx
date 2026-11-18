import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  KeybindingEditTarget,
  KeybindingProfileMutation,
  KeybindingProfileSummary,
  ServerUpsertKeybindingResult,
} from "@t3tools/contracts";
import {
  keybindingEditTarget,
  newKeybindingProfileId,
  uniqueKeybindingProfileName,
} from "@t3tools/shared/keybindingProfiles";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { msg, useGT, useMessages } from "gt-react";
import { EllipsisIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const BUILT_IN_PROFILE_NAMES: Readonly<Record<string, string>> = {
  default: msg("Default"),
};

type ProfileDialog = "duplicate" | "empty" | "rename" | "delete";

type ProfileState = Pick<
  ServerUpsertKeybindingResult,
  "keybindingProfiles" | "activeKeybindingProfile"
>;

function useProfileName() {
  const m = useMessages();
  return (profile: KeybindingProfileSummary) => {
    const builtInName = profile.builtIn ? BUILT_IN_PROFILE_NAMES[profile.id] : undefined;
    return builtInName ? m(builtInName) : profile.name;
  };
}

function activeProfileOf(state: ProfileState | null | undefined) {
  return state?.keybindingProfiles?.find((profile) => profile.id === state.activeKeybindingProfile);
}

/**
 * The profile Settings edits on every environment in scope, or undefined for a server from
 * before profiles. `everyProfile` holds the profiles of all of them, so a new copy's id and name
 * are free everywhere.
 */
export function useKeybindingEditTarget() {
  const gt = useGT();
  const profileName = useProfileName();
  return (
    primary: ProfileState | null | undefined,
    everyProfile: ReadonlyArray<KeybindingProfileSummary>,
  ): KeybindingEditTarget | undefined => {
    const active = activeProfileOf(primary);
    return active
      ? keybindingEditTarget(active, everyProfile, gt("{name} copy", { name: profileName(active) }))
      : undefined;
  };
}

/** What Reset to default restores: the parent of a custom profile. */
export function useKeybindingResetLabel(primary: ProfileState | null | undefined): string {
  const gt = useGT();
  const profileName = useProfileName();
  const active = activeProfileOf(primary);
  const parent =
    active && !active.builtIn
      ? primary?.keybindingProfiles?.find((profile) => profile.id === active.extends)
      : undefined;
  return parent ? gt("Reset to {profile}", { profile: profileName(parent) }) : "Reset to default";
}

/** Tells the user when an edit made under a built-in profile went to a new copy of it. */
export function useKeybindingProfileCopyNotice() {
  const gt = useGT();
  const profileName = useProfileName();
  return (before: ProfileState | null | undefined, after: ProfileState) => {
    const previous = activeProfileOf(before);
    const created = activeProfileOf(after);
    if (!previous?.builtIn || !created || created.builtIn) return;
    toastManager.add({
      type: "success",
      title: gt("Created {copy} so {profile} stays unchanged", {
        copy: created.name,
        profile: profileName(previous),
      }),
    });
  };
}

/**
 * Profile changes go to every environment in `targets`, so they keep the same profiles. The
 * picker shows the primary environment's.
 */
export function KeybindingProfileSection({
  environmentId,
  targets,
  everyProfile,
  profiles,
  activeProfileId,
}: {
  environmentId: EnvironmentId;
  targets: ReadonlyArray<EnvironmentId>;
  everyProfile: ReadonlyArray<KeybindingProfileSummary>;
  profiles: ReadonlyArray<KeybindingProfileSummary>;
  activeProfileId: string;
}) {
  const gt = useGT();
  const profileName = useProfileName();
  const canEdit = useAtomValue(
    serverEnvironment.mutateKeybindingProfile.permissionAtom(environmentId),
  );
  const mutateProfile = useAtomCommand(serverEnvironment.mutateKeybindingProfile, {
    reportFailure: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [dialog, setDialog] = useState<ProfileDialog | null>(null);
  const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];

  const run = async (mutation: KeybindingProfileMutation) => {
    setIsSaving(true);
    const results = await Promise.all(
      targets.map((target) => mutateProfile({ environmentId: target, input: mutation })),
    );
    setIsSaving(false);
    const result = results.find((entry) => entry._tag === "Failure");
    if (!result) {
      setDialog(null);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      title: gt("Unable to change the keybinding profile"),
      description: error instanceof Error ? error.message : undefined,
      type: "error",
    });
  };

  if (!active) return null;
  const disabled = !canEdit || isSaving;

  return (
    <SettingsSection {...searchableSetting("keybinding-profile")}>
      <SettingsRow
        title={gt("Profile")}
        description={gt(
          "Built-in profiles don't change. Editing a shortcut while one is selected creates a copy and switches to it.",
        )}
        control={
          <div className="flex items-center gap-1.5">
            <Select
              value={active.id}
              onValueChange={(profileId, eventDetails) => {
                // Base UI resets the value itself when the selected profile is deleted.
                if (eventDetails.reason === "none") return;
                if (profileId && profileId !== active.id) {
                  void run({ type: "select", profileId });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-48"
                disabled={disabled}
                aria-label={gt("Keybinding profile")}
              >
                <SelectValue>{profileName(active)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {profiles.map((profile) => (
                  <SelectItem hideIndicator key={profile.id} value={profile.id}>
                    {profileName(profile)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={gt("Profile actions")}
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => setDialog("duplicate")}>{gt("Duplicate")}</MenuItem>
                <MenuItem onClick={() => setDialog("empty")}>{gt("New empty profile")}</MenuItem>
                {active.builtIn ? null : (
                  <>
                    <MenuItem onClick={() => setDialog("rename")}>{gt("Rename")}</MenuItem>
                    <MenuItem variant="destructive" onClick={() => setDialog("delete")}>
                      {gt("Delete")}
                    </MenuItem>
                  </>
                )}
              </MenuPopup>
            </Menu>
          </div>
        }
      />
      {dialog === "delete" ? (
        <DeleteProfileDialog
          dependent={profiles.find((profile) => profile.extends === active.id)}
          extendsNothing={active.extends === null}
          profileName={profileName}
          isSaving={isSaving}
          onClose={() => setDialog(null)}
          onDelete={() => void run({ type: "delete", profileId: active.id })}
        />
      ) : dialog ? (
        <ProfileNameDialog
          mode={dialog}
          initialName={
            dialog === "rename"
              ? profileName(active)
              : uniqueKeybindingProfileName(
                  dialog === "duplicate"
                    ? gt("{name} copy", { name: profileName(active) })
                    : gt("Empty profile"),
                  new Set(everyProfile.map((profile) => profile.name)),
                )
          }
          isSaving={isSaving}
          onClose={() => setDialog(null)}
          onSave={(name) =>
            void run(
              dialog === "rename"
                ? { type: "rename", profileId: active.id, name }
                : {
                    type: "create",
                    id: newKeybindingProfileId(
                      name,
                      new Set(everyProfile.map((profile) => profile.id)),
                    ),
                    name,
                    extends: dialog === "duplicate" ? active.id : null,
                  },
            )
          }
        />
      ) : null}
    </SettingsSection>
  );
}

function ProfileNameDialog({
  mode,
  initialName,
  isSaving,
  onClose,
  onSave,
}: {
  mode: "duplicate" | "empty" | "rename";
  initialName: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const gt = useGT();
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogPopup showCloseButton={!isSaving}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed && !isSaving) onSave(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {mode === "duplicate"
                ? gt("Duplicate profile")
                : mode === "empty"
                  ? gt("New empty profile")
                  : gt("Rename profile")}
            </DialogTitle>
            {mode === "duplicate" ? (
              <DialogDescription>
                {gt("The new profile starts with these shortcuts and becomes active.")}
              </DialogDescription>
            ) : mode === "empty" ? (
              <DialogDescription>
                {gt("The new profile starts with no shortcuts and becomes active.")}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogPanel>
            <label className="block space-y-1.5 text-sm">
              <span>{gt("Name")}</span>
              <Input
                autoFocus
                required
                maxLength={64}
                value={name}
                disabled={isSaving}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isSaving} onClick={onClose}>
              {gt("Cancel")}
            </Button>
            <Button type="submit" disabled={isSaving || !trimmed}>
              {mode === "duplicate"
                ? gt("Duplicate")
                : mode === "empty"
                  ? gt("Create")
                  : gt("Rename")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function DeleteProfileDialog({
  dependent,
  extendsNothing,
  profileName,
  isSaving,
  onClose,
  onDelete,
}: {
  dependent: KeybindingProfileSummary | undefined;
  extendsNothing: boolean;
  profileName: (profile: KeybindingProfileSummary) => string;
  isSaving: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const gt = useGT();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogPopup showCloseButton={!isSaving}>
        <DialogHeader>
          <DialogTitle>{gt("Delete profile?")}</DialogTitle>
          <DialogDescription>
            {dependent
              ? gt("{profile} extends this profile. Delete {profile} first.", {
                  profile: profileName(dependent),
                })
              : extendsNothing
                ? gt("Its shortcuts are deleted and Default becomes active.")
                : gt(
                    "Its shortcuts are deleted and the profile it was duplicated from becomes active.",
                  )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={isSaving} onClick={onClose}>
            {gt("Cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isSaving || dependent !== undefined}
            onClick={onDelete}
          >
            {gt("Delete")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
