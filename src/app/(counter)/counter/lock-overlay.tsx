"use client";

import { Bell, Lock, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { PinPad } from "@/components/pin-pad";
import { t } from "@/i18n";

// S-01 lock overlay (Figma 14:1246, Flow E11): the queue keeps updating and
// chiming underneath; the signed-in user's PIN unlocks the same session.
export function LockOverlay({
  name,
  waiting,
  muted,
  onUnlock,
  onSwitchUser,
}: {
  name: string;
  waiting: number;
  muted: boolean;
  onUnlock: () => void;
  onSwitchUser: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => dialog.current?.focus(), []);

  async function check(pin: string) {
    setMessage(null);
    let response: Response;
    try {
      response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
    } catch {
      setMessage(t("error.generic"));
      return;
    }
    if (response.ok) {
      onUnlock();
      return;
    }
    const error = (await response.json().catch(() => null))?.error;
    // The session itself ended (12 h, or revoked): sign in again.
    if (error?.code === "UNAUTHENTICATED") {
      onSwitchUser();
      return;
    }
    setMessage(error?.message ?? t("error.generic"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-title"
        tabIndex={-1}
        className="flex w-140 max-w-full flex-col items-center gap-4 rounded-[24px] bg-surface p-7 shadow-dialog outline-none"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft">
          <Lock aria-hidden="true" size={28} className="text-ink" />
        </span>
        <h2 id="lock-title" className="text-h1 text-ink">
          {t("counter.lockedTitle")}
        </h2>
        <p className="text-body text-ink-muted">
          {t("counter.lockedWho", { name })}
        </p>
        <p className="flex items-center gap-2 rounded-full bg-status-waiting-bg px-3.5 py-2 text-body font-semibold text-status-waiting-fg">
          <Bell aria-hidden="true" size={20} />
          {t(muted ? "counter.waitingSoundOff" : "counter.waitingSoundOn", {
            n: waiting,
          })}
        </p>
        <PinPad
          onComplete={(pin) => void check(pin)}
          error={message !== null}
          message={message ?? undefined}
        />
        <Button
          variant="ghost"
          size="counter"
          icon={<Users aria-hidden="true" />}
          onClick={onSwitchUser}
        >
          {t("counter.notMe")}
        </Button>
      </div>
    </div>
  );
}
