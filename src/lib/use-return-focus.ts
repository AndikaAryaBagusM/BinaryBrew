"use client";

import { useRef } from "react";

// Radix Dialog gives focus back to its Trigger on close; our sheets and
// dialogs are opened from state, without a Trigger, so focus would fall to
// the page (WCAG 2.4.3). These handlers remember what had focus when the
// dialog opened and focus it again on close, if it is still on the page.
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const element = opener.current;
      opener.current = null;
      if (element?.isConnected) {
        event.preventDefault();
        element.focus();
      }
    },
  };
}
