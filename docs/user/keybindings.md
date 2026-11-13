# Keybindings

Customize shortcuts in **Settings → Keybindings** on web and desktop. That page
also lists the command IDs and defaults available in your version.

To free a default shortcut for another command, choose **Unassign** from its row's
actions menu. **Reset to default** brings it back. To keep several sets of
shortcuts, see [Profiles](#profiles).

## Composer controls

`mod+shift+d` starts dictation in the focused editor, or the composer, and finishes it on the next press;
`Esc` discards the recording. Change the chord under **Composer: Start or Finish
Dictation**, and the hold or toggle behavior in **Settings → Voice**. See
[Voice input](./voice-input.md).

In **Settings → Chat → Send shortcut**, choose whether Enter sends, requires
`mod+Enter` for multiline prompts, or always requires `mod+Enter`. `Shift+Enter`
inserts a new line. This applies to the web and desktop composer at desktop widths.

**Follow-up behavior** chooses Queue or Steer while the agent runs. Use
`mod+Enter` to do the opposite for one message, even when the send shortcut
requires a modifier. `mod+Alt+Enter` sends, keeps that thread running in the
background, and opens a fresh new-thread composer. In a new thread, `mod+Enter`
does the same. Change these shortcuts in **Settings → Keybindings** under
**Composer: Opposite Queue or Steer Action**, **Composer: Start in Background**,
or **Composer: Send and Start New Thread**. These bindings take priority over the
send shortcut. Click the send button to use the configured follow-up behavior.

When a thread has queued messages, `mod+Shift+Enter` sends the first one as a steer
while a turn is running, or as a new turn when the thread is stopped. Change it under
**Queue: Send First Queued Message** in Keybindings.

Use `mod+shift+m` to choose a model and `mod+shift+h` to choose a host.
To step a new thread to the next machine instead of opening the menu, bind
**Composer: Cycle Host** in Keybindings. It has no default shortcut.
Use `mod+shift+e` for effort, `mod+shift+a` for permissions, `mod+shift+x` for the
workspace, and `mod+shift+g` for the Git branch. The workspace menu includes the
current checkout, a new worktree, and the previous worktree when available.
Use `mod+shift+l` to reuse the previous worktree directly.

To change effort one step without opening the picker, bind
**Composer: Increase Effort** and **Composer: Decrease Effort** in Keybindings.
Both are unbound by default. Increase wraps from the highest level to the
lowest, and decrease wraps from the lowest level to the highest.

In the model picker, press Left in an empty search field or Shift+Tab to reach
the provider list. Use Up/Down to move and Enter to choose. Right returns to
model search. Right at the end of the search moves to the highlighted model's effort
levels, and Left comes back. Choosing a model keeps the picker open on its effort. `mod+shift+up` and `mod+shift+down` switch providers directly and clear the
search. These provider shortcuts can also be changed in Settings.

These shortcuts run inside the focused web or desktop client. `mod` uses Command
on macOS and Ctrl on Windows and Linux, including GNOME, KDE Plasma, Niri, and
Hyprland. If a custom desktop shortcut takes the same keys, choose another binding
in Settings.

## Copy pull request references

With a PR open in the right panel or on the Pull requests page, use `mod+shift+c`
to copy its URL and `mod+shift+k` to copy its number with a `#` prefix.
Both shortcuts can be changed in Settings. Search for “Copy Link or Thread”
or “Copy Number”. They copy the selected PR and leave terminal input alone.
Without a PR, `mod+shift+c` copies the thread itself, which pastes into a
composer as a thread chip.

## Find in a diff

Click into a diff in the Diff panel or a pull request's Code tab, then press
`mod+f` to search every file in it, including folded files and unchanged lines
hidden between changes. Enter and `Shift+Enter` move between matches, and a
match in a folded file opens it. Escape closes the search. This shortcut is not
configurable. A very large uncommitted diff loads its files as you scroll, and
find only searches the files loaded so far.

## iPad

With a hardware keyboard, use `Cmd+1` through `Cmd+9` to open the first nine
displayed threads. The shortcuts follow the current list filters and order.
`Cmd+K` opens the command palette to search commands, projects, and threads.
Use the arrow keys and Return to choose a result, or `Cmd+1` through `Cmd+9` to
choose directly. Escape or `Cmd+K` closes the palette. Start a search with `>`
to show only actions.

In a new thread, `Cmd+Shift+H` moves the draft to the next machine.

In the composer, Return sends and `Shift+Return` inserts a new line. While a
turn is running, `Cmd+Return` sends with the other follow-up action. To make
Return insert a new line instead, change the Return key behavior in Settings →
Keyboard; `Cmd+Return` then sends.

## Android

With a hardware keyboard, the composer handles Return as on iPad, with `Ctrl` in
place of `Cmd`. The on-screen keyboard's Return always inserts a new line.

## Profiles

A profile is a named set of shortcuts. T3 Code ships the **Default** profile.
Pick a profile from the profile menu in **Settings → Keybindings**. One profile
is active at a time, and only its shortcuts apply.

Built-in profiles don't change. When you change a shortcut while one is
selected, T3 Code creates a copy of it, such as "Default copy", switches to the
copy and saves the change there. Later changes stay in that copy. Selecting the
built-in again and changing a shortcut makes another copy. A change that leaves
the shortcuts as they were makes none.

**Duplicate** makes a profile that starts from the active one under a name you
choose, and switches to it. It keeps following the original: shortcuts you
haven't changed in it change when the original does. **Rename** and **Delete**
work on profiles you made. Deleting the active profile switches to the one it
extends. A profile that another profile extends can't be deleted until that one
is gone.

**New empty profile** makes a profile with no shortcuts at all and switches to
it. Every command starts unassigned, so only the shortcuts you add apply.

When the scope picker covers several machines, profile changes and shortcut
changes go to each of them, so they keep the same profiles. A machine where the
change doesn't fit, for example because another profile is active there,
reports an error and keeps its shortcuts.

## Edit the configuration file

Keybindings live on the environment's machine, in
`~/.t3/userdata/keybindings.json` by default. You can edit this file directly:

```json
{
  "profile": "hugo",
  "profiles": {
    "hugo": {
      "name": "Hugo",
      "extends": "default",
      "keybindings": [
        { "key": "ctrl+alt+b", "command": "sidebar.toggle" },
        { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
      ]
    }
  },
  "scripts": [{ "key": "mod+shift+r", "command": "script.test.run" }]
}
```

`profile` names the active profile. `profiles` holds the profiles you made,
keyed by id, so a JSON merge can add one without touching the others. An id uses
lowercase letters, digits and dashes. Profiles T3 Code creates get ids starting
with `my-`, which no built-in profile uses. `extends` names the profile each one
starts from, `default` if you leave it out, or `null` for a profile that starts
from no shortcuts.

`scripts` holds the shortcuts of project scripts, the `script.<id>.run`
commands. They apply whatever profile is active, so saving one never copies a
built-in profile.

The file holds only your changes. The defaults come from the profile, so new
defaults in later versions reach you without edits. A profile's rules for a
command replace every rule its parent has for that command. To keep a default
shortcut next to a new one, list both. To turn a default off, give it
`"when": "false"`, which is what **Unassign** writes.

Older versions wrote a JSON array of rules that included every default. The
first start after upgrading saves that file as `keybindings.json.pre-profiles`
and converts it. Commands whose rules match the defaults of this or an earlier
version are dropped. Project script shortcuts move to `scripts`. The rest,
unassigned shortcuts included, go into a new profile named Custom that extends Default and becomes active. If nothing is
left, Default stays active.

Invalid rules are ignored, and T3 Code keeps them in the file when it saves, so
rules for commands from a newer version survive. If the file cannot be parsed,
T3 Code uses the defaults and does not overwrite the file. Versions from before
profiles cannot read the new format and fall back to their defaults. To go back
to one, restore `keybindings.json.pre-profiles`.

## Rule shape

Each rule requires a `key` shortcut and a `command` ID. An optional `when`
expression restricts when it runs.

Project scripts use `script.{id}.run`, such as `script.test.run`.

## Key syntax

Join modifiers and a key with `+`, such as `mod+shift+d` or `ctrl+l`.
`mod` means Command on macOS and Control elsewhere. Other modifiers are
`cmd` / `meta`, `ctrl` / `control`, `alt` / `option`, and `shift`.

### Key sequences

Separate keys with a space to bind a sequence of up to four keys, like Emacs
prefix keys. With `ctrl+x ctrl+b`, press Ctrl+X, then Ctrl+B. Spaces next to a `+`
do not split keys, so `ctrl + x` is still one key.

```json
{ "key": "ctrl+x ctrl+b", "command": "sidebar.toggle", "when": "!terminalFocus" }
```

After the first key, a small notice shows the keys pressed so far, and T3 Code
waits for the next one with no timeout. A key that does not continue any
sequence cancels it and shows that the sequence is undefined. Escape, a click, or
moving focus also cancels. Keep `!terminalFocus` if the shell should still
receive the first key.

To record a sequence in Settings, record the first key, then press **+** beside
it for each further key. Each key has its own remove button, and clicking a key
records it again. The same controls set an action's shortcut. Settings warns when
one shortcut's keys start another's. Sequences run in
the app window only. A focused desktop browser or HTML preview, and clients
older than this feature, ignore them.

## When conditions

Available context keys are `terminalFocus`, `terminalOpen`, `previewFocus`,
`previewOpen`, `rightPanelOpen`, `modelPickerOpen`, `usagePageOpen`, `composerFocus`,
`draftThreadRoute`, `turnRunning`, `editableFocus`, `isWeb`, and `isDesktop`.
In a thread, `rightPanelOpen` is true while its right panel is open; the default
`mod+t` uses it to open the panel's new-tab menu.
`draftThreadRoute` is true on a draft thread, including a restored draft, until it is first sent.
`editableFocus` is true while a text field, the composer, or another editor has
the keyboard. `isWeb` is true in a browser tab. `isDesktop` is true in the
desktop app. Unknown keys evaluate to `false`.

`mod+1` through `mod+9` jump to the first nine threads, and to models while the
model picker is open. The thread jumps do not run while the model picker is open.
Those defaults use `isDesktop` so they do not steal the
browser's tab-switch shortcuts. Remove that condition in Settings if you want
the same jumps in a browser.

Combine keys with `!` for not, `&&` for and, `||` for or, and parentheses:

```json
{ "key": "mod+j", "command": "terminal.toggle", "when": "terminalOpen && !terminalFocus" }
```

## Find in the current thread

`chat.find` searches conversation messages and proposed plans in the active thread. Entering a
query searches the entire thread, including older messages. Thread search requires server support;
update an older server to enable it. Select **Retry** if a search fails. It defaults to
`mod+f` outside terminals and previews. Press **Enter** or **Shift+Enter** to move between matches,
and **Escape** to close find.

## Find on a browser page

`preview.find` (`mod+f` while a browser has focus) searches the open page in the desktop app. It
is also in the browser's **⋮** menu and the command palette. A page that handles `mod+f` itself,
such as a code editor, keeps its own find. Use the **⋮** menu to reach the browser's find there.
Streamed browser tabs and T3 Code in a web browser do not support it.

## Precedence

The last rule whose key and condition both match wins, even if it belongs to a
different command. Your own rules come after the profile's, so they win a
shortcut they share with it. Put a more specific rule after a general one when
they share a shortcut. A key that starts an active sequence wins over a single-key rule on
the same key, whatever their order.

## Commands with special behavior

`thread.stop` interrupts the running turn in the focused thread. It has no default
shortcut; assign one in **Settings → Keybindings**.

`thread.regenerateTitle` generates a new title for the focused thread, like
**Regenerate title** in the thread menu. It has no default shortcut.

`thread.undo` (`mod+z` by default) reverses the actions shown in the notice at the
bottom of the sidebar, such as unpin, settle, snooze, archive, or discarding a
draft. Consecutive
actions of the same kind undo together. The notice remains available for five
seconds after the latest action. Right after an action, the shortcut works even
in a text field such as the composer. Once you type or press another key, the
field gets its own undo back. Terminals always keep their native shortcut.

`navigation.back` (`mod+[` by default) and `navigation.forward` (`mod+]`) move
through the pages you have visited, like a browser's back and forward buttons.

`chat.new` may ask you to choose a project when there is more than one.
`chat.newLocal` skips that chooser. Both use your
[new-thread defaults](./thread-sidebar.md#start-a-thread). `chat.newWithoutProject`
(`mod+alt+n`) starts a thread [without a project](./thread-sidebar.md#start-without-a-project).

## Text editing commands

The `text.*` commands edit the focused text field or the composer: moving by
character, word, line, or the whole field, deleting, cutting, pasting, and
swapping characters. They have no default shortcuts, so typing works as it
always did until you bind them.

Cuts go to a list of recent cuts inside T3 Code, not to the system clipboard.
Cuts made one after another in the same field join into one entry.
`text.paste` inserts the newest entry, and `text.pasteOlder` right after it
swaps in the entry before. `text.cutSelection` cuts the word before the caret
when nothing is selected. After `text.anchorSelection`, moving the caret,
with the arrow, Home and End keys too, selects text until you cut, copy,
type, or run `text.clearSelection`. That includes their word and document
motions, such as Alt+Left and Ctrl+End, or Cmd+Up on macOS.

The field remembers that position as its mark after the selection ends.
`text.exchangePointAndMark` moves the caret to the mark and selects the text
between them. Pasting, `text.cursorDocumentStart`, `text.cursorDocumentEnd`,
and `text.selectAll` also set the mark.

`text.transposeWords` swaps the words before and after the caret.
`text.upcaseWord`, `text.downcaseWord`, and `text.capitalizeWord` change the
text from the caret to the end of the next word. `text.newline` starts a new
line in the composer or a multi-line field without sending.

`text.cursorLineDown` and `text.cursorLineUp` act as Down and Up in a list:
the command palette, pickers, and the composer's suggestions.

To edit like Emacs, add these rules to `keybindings.json`. Some replace
defaults while a field has focus, such as `ctrl+k` for the command palette and
`ctrl+n` for a new thread on Windows and Linux, so rebind those commands if
you need them from a field. `ctrl+u` cuts to the start of the line as in a
shell, since T3 Code has no prefix arguments.

```json
[
  { "key": "ctrl+f", "command": "text.cursorForward", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+b", "command": "text.cursorBackward", "when": "editableFocus && !terminalFocus" },
  {
    "key": "alt+f",
    "command": "text.cursorWordForward",
    "when": "editableFocus && !terminalFocus"
  },
  {
    "key": "alt+b",
    "command": "text.cursorWordBackward",
    "when": "editableFocus && !terminalFocus"
  },
  { "key": "ctrl+a", "command": "text.cursorLineStart", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+e", "command": "text.cursorLineEnd", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+n", "command": "text.cursorLineDown", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+p", "command": "text.cursorLineUp", "when": "editableFocus && !terminalFocus" },
  {
    "key": "alt+shift+,",
    "command": "text.cursorDocumentStart",
    "when": "editableFocus && !terminalFocus"
  },
  {
    "key": "alt+shift+.",
    "command": "text.cursorDocumentEnd",
    "when": "editableFocus && !terminalFocus"
  },
  { "key": "ctrl+d", "command": "text.deleteForward", "when": "editableFocus && !terminalFocus" },
  { "key": "alt+d", "command": "text.cutWordForward", "when": "editableFocus && !terminalFocus" },
  {
    "key": "alt+backspace",
    "command": "text.cutWordBackward",
    "when": "editableFocus && !terminalFocus"
  },
  { "key": "ctrl+k", "command": "text.cutToLineEnd", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+u", "command": "text.cutToLineStart", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+w", "command": "text.cutSelection", "when": "editableFocus && !terminalFocus" },
  { "key": "alt+w", "command": "text.copySelection", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+y", "command": "text.paste", "when": "editableFocus && !terminalFocus" },
  { "key": "alt+y", "command": "text.pasteOlder", "when": "editableFocus && !terminalFocus" },
  {
    "key": "ctrl+t",
    "command": "text.transposeCharacters",
    "when": "editableFocus && !terminalFocus"
  },
  {
    "key": "ctrl+space",
    "command": "text.anchorSelection",
    "when": "editableFocus && !terminalFocus"
  },
  { "key": "ctrl+g", "command": "text.clearSelection", "when": "editableFocus && !terminalFocus" },
  {
    "key": "ctrl+x ctrl+x",
    "command": "text.exchangePointAndMark",
    "when": "editableFocus && !terminalFocus"
  },
  { "key": "ctrl+x h", "command": "text.selectAll", "when": "editableFocus && !terminalFocus" },
  { "key": "alt+t", "command": "text.transposeWords", "when": "editableFocus && !terminalFocus" },
  { "key": "alt+u", "command": "text.upcaseWord", "when": "editableFocus && !terminalFocus" },
  { "key": "alt+l", "command": "text.downcaseWord", "when": "editableFocus && !terminalFocus" },
  {
    "key": "alt+c",
    "command": "text.capitalizeWord",
    "when": "editableFocus && !terminalFocus"
  },
  { "key": "ctrl+j", "command": "text.newline", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+/", "command": "text.undo", "when": "editableFocus && !terminalFocus" },
  { "key": "ctrl+shift+-", "command": "text.undo", "when": "editableFocus && !terminalFocus" }
]
```

## Reserved shortcuts

In the desktop app, `mod+w` closes the focused terminal or the active right-panel
tab. When nothing remains to close, it does nothing; it never closes the window. In a browser, `mod+w`
closes the browser tab; rebind `rightPanel.close` and `terminal.close` to an available
shortcut such as `alt+w`.

`mod+shift+t` reopens the last closed tab across the app, including files,
diffs, pull requests, browsers, and devices, in the order you closed them.
A browser opens in a fresh session without its old page history. Incognito tabs
can reopen until you reload or quit the app. This shortcut does not undo deleted work.
Browsers also use it to reopen browser tabs; choose another binding in Settings
if the browser takes it first.

Many defaults include `!terminalFocus` so they do not intercept terminal input.
Keep that condition when remapping them if you want the same behavior.

## Desktop quit shortcut

Use `Cmd+Q` on macOS or `Ctrl+Q` on Windows and Linux. In the default **Hold** mode,
hold for 1.2 seconds or press twice within 500 milliseconds. Holding requires
keyboard repeat; if repeat is disabled, use two presses or the application menu.

Change **Settings → General → Confirmations → Quit shortcut** to **Direct** for a
single press or **Double press** for two presses only. Choosing **Quit** from the
application menu always quits immediately.
