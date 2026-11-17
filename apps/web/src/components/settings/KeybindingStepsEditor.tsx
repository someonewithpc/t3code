import { PlusIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type Ref, useRef } from "react";
import { parseKeybindingShortcut, splitKeybindingSequence } from "@t3tools/shared/keybindings";

import { formatShortcutLabel } from "../../keybindings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { canAddKeybindingStep } from "./KeybindingsSettings.logic";

export const KEYBINDING_PILL_BUTTON_CLASS =
  "inline-flex h-8 cursor-pointer items-center rounded-md border border-transparent px-1.5 sm:h-7 outline-none transition-colors hover:border-border/70 hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/24";

export function KeybindingPill({ value }: { value: string }) {
  const steps = value.split(" ");
  if (steps.length === 1) return <KeybindingStepPill value={value} />;
  // A sequence can repeat a step, as in ctrl+x ctrl+x.
  const seenSteps = new Map<string, number>();
  const keyedSteps = steps.map((step) => {
    const seen = seenSteps.get(step) ?? 0;
    seenSteps.set(step, seen + 1);
    return { step, key: seen === 0 ? step : `${step}-${seen}` };
  });
  return (
    <span className="inline-flex items-center gap-1.5">
      {keyedSteps.map(({ step, key }) => (
        <KeybindingStepPill key={key} value={step} />
      ))}
    </span>
  );
}

function KeybindingStepPill({ value }: { value: string }) {
  // Keys dedupe repeated parts; a literal "+" in a shortcut splits into empty strings.
  const seenParts = new Map<string, number>();
  const parts = value.split("+").map((part) => {
    const seen = seenParts.get(part) ?? 0;
    seenParts.set(part, seen + 1);
    return { part, key: seen === 0 ? part : `${part}-${seen}` };
  });
  return (
    <KbdGroup>
      {parts.map(({ part, key }) => (
        <Kbd key={key}>
          {part === "mod"
            ? navigator.platform.toLowerCase().includes("mac")
              ? "⌘"
              : "Ctrl"
            : part === "shift"
              ? "⇧"
              : part === "alt"
                ? navigator.platform.toLowerCase().includes("mac")
                  ? "⌥"
                  : "Alt"
                : part === "ctrl"
                  ? "⌃"
                  : part.length === 1
                    ? part.toUpperCase()
                    : part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function stepLabel(step: string): string {
  const shortcut = parseKeybindingShortcut(step);
  return shortcut ? formatShortcutLabel(shortcut) : step;
}

function StepIconButton({
  label,
  tooltip,
  buttonRef,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tooltip: string;
  buttonRef: Ref<HTMLButtonElement>;
  disabled?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        ref={buttonRef}
        delay={200}
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-xs"
            disabled={disabled}
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export function KeybindingAddStepButton({
  label,
  buttonRef,
  disabled,
  onClick,
}: {
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <StepIconButton
      label={`Add a key to the shortcut for ${label}`}
      tooltip="Add key"
      buttonRef={buttonRef ?? null}
      disabled={disabled}
      onClick={onClick}
    >
      <PlusIcon aria-hidden className="size-3.5" />
    </StepIconButton>
  );
}

/** What a recorder keydown did. The editor moves focus only for these. */
export type KeybindingStepCapture = "recorded" | "cancelled" | null;

type FocusTarget =
  | { readonly kind: "chip" | "remove"; readonly index: number }
  | { readonly kind: "add" | "field" };

/**
 * Records a shortcut one chord at a time. Each step is a button that records it again, and the
 * add button records one more step after the last.
 */
export function KeybindingStepsEditor({
  value,
  recordingStep,
  label,
  placeholder,
  minSteps,
  disabled,
  fieldId,
  onRecordingStepChange,
  onRecorderKeyDown,
  onChange,
  onEscape,
}: {
  value: string;
  /** The step being recorded; the step count appends one. */
  recordingStep: number | null;
  label: string;
  placeholder: string;
  /** 1 keeps the last step; 0 lets removing it clear the shortcut. */
  minSteps: 0 | 1;
  disabled?: boolean | undefined;
  fieldId?: string | undefined;
  onRecordingStepChange: (step: number | null) => void;
  onRecorderKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    step: number,
  ) => KeybindingStepCapture;
  onChange: (value: string) => void;
  onEscape?: (() => void) | undefined;
}) {
  const steps = splitKeybindingSequence(value);
  // A sequence can repeat a step, as in ctrl+x ctrl+x.
  const seenSteps = new Map<string, number>();
  const stepKeys = steps.map((step) => {
    const seen = seenSteps.get(step) ?? 0;
    seenSteps.set(step, seen + 1);
    return seen === 0 ? step : `${step}-${seen}`;
  });
  const pendingFocus = useRef<FocusTarget | null>(null);

  // Inline ref callbacks run on every commit, so the element named by pendingFocus takes focus
  // in the render that follows the keydown or click.
  const focusWhenPending = (target: FocusTarget) => (element: HTMLElement | null) => {
    const pending = pendingFocus.current;
    if (!element || !pending || pending.kind !== target.kind) return;
    if ("index" in pending && "index" in target && pending.index !== target.index) return;
    pendingFocus.current = null;
    element.focus();
  };

  const handleRecorderKeyDown = (event: KeyboardEvent<HTMLInputElement>, step: number) => {
    if (onRecorderKeyDown(event, step) === null) return;
    pendingFocus.current = step >= steps.length ? { kind: "add" } : { kind: "chip", index: step };
  };

  const removeStep = (index: number) => {
    const remaining = steps.length - 1;
    const nextIndex = Math.min(index, remaining - 1);
    pendingFocus.current =
      remaining === 0
        ? { kind: "field" }
        : remaining > minSteps
          ? { kind: "remove", index: nextIndex }
          : { kind: "chip", index: nextIndex };
    onChange(steps.filter((_, stepIndex) => stepIndex !== index).join(" "));
  };

  const recorder = (step: number) => (
    <Input
      key={`recorder-${step}`}
      data-keybinding-capture=""
      autoFocus
      aria-label={`Key ${step + 1} of the shortcut for ${label}`}
      value=""
      readOnly
      placeholder="Press shortcut"
      size="sm"
      font="mono"
      className="w-32"
      onBlur={() => onRecordingStepChange(null)}
      onKeyDown={(event) => handleRecorderKeyDown(event, step)}
    />
  );

  if (steps.length === 0) {
    return (
      <Input
        ref={focusWhenPending({ kind: "field" })}
        id={fieldId}
        data-keybinding-capture=""
        autoFocus={recordingStep !== null}
        disabled={disabled}
        aria-label={fieldId ? undefined : `Keybinding for ${label}`}
        value=""
        readOnly
        placeholder={recordingStep !== null ? "Press shortcut" : placeholder}
        size="sm"
        font="mono"
        className="w-44"
        onFocus={() => onRecordingStepChange(0)}
        onBlur={() => onRecordingStepChange(null)}
        onKeyDown={(event) => handleRecorderKeyDown(event, 0)}
      />
    );
  }

  return (
    <div
      role="group"
      aria-label={`Shortcut for ${label}`}
      className="inline-flex flex-wrap items-center gap-1"
      // Capture, so an open tooltip does not swallow the Escape first.
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || !onEscape) return;
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
    >
      {steps.map((step, index) =>
        recordingStep === index ? (
          recorder(index)
        ) : (
          <span key={stepKeys[index]} className="inline-flex items-center">
            <button
              ref={focusWhenPending({ kind: "chip", index })}
              type="button"
              disabled={disabled}
              aria-label={`Change key ${index + 1} of the shortcut for ${label}: ${stepLabel(step)}`}
              className={KEYBINDING_PILL_BUTTON_CLASS}
              onClick={() => onRecordingStepChange(index)}
            >
              <KeybindingStepPill value={step} />
            </button>
            {steps.length > minSteps ? (
              <StepIconButton
                label={`Remove key ${index + 1} (${stepLabel(step)}) from the shortcut for ${label}`}
                tooltip="Remove key"
                buttonRef={focusWhenPending({ kind: "remove", index })}
                disabled={disabled}
                onClick={() => removeStep(index)}
              >
                <XIcon aria-hidden className="size-3.5" />
              </StepIconButton>
            ) : null}
          </span>
        ),
      )}
      {recordingStep === steps.length ? (
        recorder(steps.length)
      ) : canAddKeybindingStep(value) ? (
        <KeybindingAddStepButton
          label={label}
          buttonRef={focusWhenPending({ kind: "add" })}
          disabled={disabled}
          onClick={() => onRecordingStepChange(steps.length)}
        />
      ) : null}
    </div>
  );
}
