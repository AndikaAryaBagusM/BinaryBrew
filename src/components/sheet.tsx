"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/i18n";

// Bottom sheet (Design §5; Figma "Sheet header" 5:255): drag handle, title,
// scrolling content and a sticky action bar. Radix Dialog traps focus, closes
// on Esc and labels the sheet with its title. The handle is visual only.
export type SheetProps = {
  title: string;
  description?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  actions?: ReactNode;
  showClose?: boolean;
  children?: ReactNode;
};

export function Sheet({
  title,
  description,
  open,
  onOpenChange,
  trigger,
  actions,
  showClose = true,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 motion-safe:animate-fade-in" />
        <Dialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-120 flex-col rounded-t-sheet bg-surface pb-[env(safe-area-inset-bottom)] shadow-sheet outline-none motion-safe:animate-sheet-in motion-reduce:animate-fade-in"
        >
          <div className="flex flex-col items-center pt-2">
            <div aria-hidden="true" className="h-1 w-9 rounded-[2px] bg-line" />
            <div className="flex w-full items-center gap-2 py-1 pr-1 pl-4">
              <Dialog.Title className="flex-1 text-h1 text-ink">
                {title}
              </Dialog.Title>
              {showClose && (
                <Dialog.Close
                  aria-label={t("common.close")}
                  className="focus-ring flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink active:bg-surface-sunken"
                >
                  <X aria-hidden="true" size={22} />
                </Dialog.Close>
              )}
            </div>
          </div>
          {description && (
            <Dialog.Description className="px-4 text-body text-ink-muted">
              {description}
            </Dialog.Description>
          )}
          <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
            {children}
          </div>
          {actions && (
            <div className="flex flex-col gap-2 border-t border-line px-4 pt-3 pb-4">
              {actions}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
