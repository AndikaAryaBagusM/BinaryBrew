"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

// Counter dialogs (Design §6.2, §8): a centred dialog (S-03, S-04, S-05,
// S-07) or a drawer from the right (S-06, S-08). Radix Dialog traps focus,
// closes on Esc and labels the dialog with its title. `title` may be visually
// hidden when the content shows its own heading.
export type ModalProps = {
  title: ReactNode;
  hideTitle?: boolean;
  description?: ReactNode;
  placement?: "center" | "drawer";
  width?: string; // Tailwind width class of the centred dialog
  onClose?: () => void; // omitted: Esc and the overlay do not close it
  children?: ReactNode;
  className?: string;
};

export function Modal({
  title,
  hideTitle = false,
  description,
  placement = "center",
  width = "w-170",
  onClose,
  children,
  className,
}: ModalProps) {
  const drawer = placement === "drawer";
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 motion-safe:animate-fade-in" />
        <Dialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          onEscapeKeyDown={(event) => {
            if (!onClose) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!onClose) event.preventDefault();
          }}
          className={cn(
            "fixed z-50 flex flex-col bg-surface shadow-dialog outline-none motion-safe:animate-fade-in",
            drawer
              ? "inset-y-0 right-0 w-140 max-w-full"
              : cn(
                  "top-1/2 left-1/2 max-h-[calc(100dvh-48px)] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[24px]",
                  width,
                ),
            className,
          )}
        >
          <div
            className={cn(
              "flex items-start gap-3 px-6 pt-6",
              hideTitle && "sr-only",
            )}
          >
            <Dialog.Title className="flex-1 text-counter-title text-ink">
              {title}
            </Dialog.Title>
            {onClose && !hideTitle && (
              <Dialog.Close
                aria-label={t("common.close")}
                className="focus-ring flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-sunken text-ink active:bg-line"
              >
                <X aria-hidden="true" size={24} />
              </Dialog.Close>
            )}
          </div>
          {description && (
            <Dialog.Description className="px-6 pt-2 text-body text-ink-muted">
              {description}
            </Dialog.Description>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
