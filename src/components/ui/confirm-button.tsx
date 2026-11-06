"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  /** Trigger label. */
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /**
   * Runs on confirm. Without it, confirming submits the form that contains
   * the trigger, so server-action forms keep working unchanged.
   */
  onConfirm?: () => void;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

/** A button that asks for confirmation before a destructive action. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  size = "sm",
  variant = "secondary",
  disabled,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  function confirm() {
    setOpen(false);
    if (onConfirm) onConfirm();
    else trigger.current?.form?.requestSubmit();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          ref={trigger}
          type="button"
          size={size}
          variant={variant}
          disabled={disabled}
          className={className}
          aria-label={ariaLabel}
        >
          {children}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/35" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-paper p-5 shadow-[0_24px_80px_rgba(28,45,65,0.22)]">
          <Dialog.Title className="font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">
            {description}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              className="bg-red-700 hover:bg-red-800"
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
