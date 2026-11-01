"use client";

import { Lock, Tablet, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Button } from "@/components/button";
import { PinPad } from "@/components/pin-pad";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/initials";
import { formatTime } from "@/lib/time";
import type { UserRole } from "@/modules/auth/service";
import { roleLabel } from "../role-label";

// S-01 (Figma 14:1010, 14:1041, 14:1127, 14:1201): choose your name, then
// the PIN; 5 wrong PINs lock that user for 5 minutes (PRD A4).

type PinUser = { id: string; name: string; role: UserRole };

type Failure =
  | { kind: "wrong"; message: string }
  | { kind: "locked"; lockedUntil: Date; minutes: number };

export function LoginScreen({
  deviceName,
  users,
}: {
  deviceName: string;
  users: PinUser[];
}) {
  const [selected, setSelected] = useState<PinUser | null>(null);
  if (!selected) {
    return (
      <main className="flex min-h-dvh flex-col items-center gap-8 bg-bg px-4 pt-24">
        <BrandWordmark size="l" />
        <h1 className="text-center text-display-m text-ink">
          {t("counter.chooseName")}
        </h1>
        <div className="flex flex-wrap justify-center gap-5">
          {users.map((user) => (
            <StaffTile
              key={user.id}
              user={user}
              onClick={() => setSelected(user)}
            />
          ))}
        </div>
        <p className="flex items-center gap-2 text-body text-ink-muted">
          <Tablet aria-hidden="true" size={20} />
          {t("counter.deviceLine", { device: deviceName })}
        </p>
      </main>
    );
  }
  return (
    <PinStep
      key={selected.id}
      user={selected}
      onBack={() => setSelected(null)}
    />
  );
}

function PinStep({ user, onBack }: { user: PinUser; onBack: () => void }) {
  const router = useRouter();
  const [failure, setFailure] = useState<Failure | null>(null);

  async function check(pin: string) {
    setFailure(null);
    let response: Response;
    try {
      response = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, pin }),
      });
    } catch {
      setFailure({ kind: "wrong", message: t("error.generic") });
      return;
    }
    if (response.ok) {
      router.replace("/counter");
      return;
    }
    const error = (await response.json().catch(() => null))?.error;
    if (error?.code === "ACCOUNT_LOCKED") {
      const lockedUntil = new Date(error.details.lockedUntil);
      setFailure({
        kind: "locked",
        lockedUntil,
        minutes: Math.max(
          1,
          Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
        ),
      });
    } else {
      setFailure({
        kind: "wrong",
        message: error?.message ?? t("error.generic"),
      });
    }
  }

  return (
    <main className="flex min-h-dvh bg-bg">
      <section className="flex w-[44%] flex-col items-center justify-center gap-5 bg-surface px-4">
        <BrandWordmark />
        <StaffTile user={user} selected />
        <Button
          variant="ghost"
          size="counter"
          icon={<Users aria-hidden="true" />}
          onClick={onBack}
        >
          {t("counter.notMe")}
        </Button>
      </section>
      <section className="flex flex-1 flex-col items-center justify-center gap-5 px-4">
        {failure?.kind === "locked" ? (
          <Locked
            lockedUntil={failure.lockedUntil}
            minutes={failure.minutes}
            onBack={onBack}
          />
        ) : (
          <>
            <h1 className="text-display-m text-ink">{t("counter.enterPin")}</h1>
            <PinPad
              onComplete={(pin) => void check(pin)}
              error={failure !== null}
              message={failure?.kind === "wrong" ? failure.message : undefined}
              hint={t("counter.pinHint")}
            />
          </>
        )}
      </section>
    </main>
  );
}

function Locked({
  lockedUntil,
  minutes,
  onBack,
}: {
  lockedUntil: Date;
  minutes: number;
  onBack: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-5 text-center">
      <span className="flex size-24 items-center justify-center rounded-full bg-danger-soft">
        <Lock aria-hidden="true" size={44} className="text-danger" />
      </span>
      <h1 className="text-display-m text-ink">
        {t("counter.locked", { minutes })}
      </h1>
      <p className="max-w-md text-counter-body text-ink-muted">
        {t("counter.lockedUntil", { time: formatTime(lockedUntil) })}
      </p>
      <Button
        variant="secondary"
        size="counter"
        icon={<Users aria-hidden="true" />}
        onClick={onBack}
      >
        {t("counter.otherStaff")}
      </Button>
    </div>
  );
}

function StaffTile({
  user,
  selected = false,
  onClick,
}: {
  user: PinUser;
  selected?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-18 items-center justify-center rounded-full text-counter-title",
          selected ? "bg-brand text-on-brand" : "bg-accent-soft text-brand",
        )}
      >
        {initials(user.name)}
      </span>
      <span className="text-counter-body text-ink">{user.name}</span>
      <span className="text-caption text-ink-muted">
        {t(roleLabel[user.role])}
      </span>
    </>
  );
  const tileClass = cn(
    "flex h-46 w-50 flex-col items-center justify-center gap-2 rounded-key",
    selected
      ? "border-3 border-brand bg-accent-soft"
      : "border border-line bg-surface",
  );
  if (!onClick) return <div className={tileClass}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        tileClass,
        "focus-ring cursor-pointer transition-colors duration-100 active:bg-accent-soft",
      )}
    >
      {content}
    </button>
  );
}
