"use client";

import { CircleAlert, Lock, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";

// O-01: 5 failures per 15 minutes per account and per IP are refused with
// RATE_LIMITED (FR-OW-01); the server never says which part was wrong.
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<
    { kind: "wrong"; message: string } | { kind: "limited" } | null
  >(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const result = await api("/api/auth/owner-login", {
      method: "POST",
      body: { email: email.trim(), password },
    });
    if (result.ok) {
      router.replace("/owner/menu");
      router.refresh();
      return;
    }
    setBusy(false);
    setPassword("");
    setFailure(
      result.error.code === "RATE_LIMITED"
        ? { kind: "limited" }
        : { kind: "wrong", message: result.error.message },
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <form
        onSubmit={(event) => void submit(event)}
        className="flex w-110 max-w-full flex-col gap-4.5 rounded-sheet bg-surface p-6 shadow-dialog sm:p-9"
      >
        <BrandWordmark size="l" />
        <h1 className="text-h1 text-ink">{t("owner.loginTitle")}</h1>
        {failure?.kind === "limited" && (
          <div
            role="alert"
            className="flex gap-2.5 rounded-card bg-danger-soft p-3.5"
          >
            <CircleAlert
              aria-hidden="true"
              size={20}
              className="mt-0.5 shrink-0 text-danger"
            />
            <div>
              <p className="text-owner-body font-semibold text-ink">
                {t("owner.loginLimitedTitle")}
              </p>
              <p className="text-caption text-ink-muted">
                {t("owner.loginLimitedBody")}
              </p>
            </div>
          </div>
        )}
        <TextField
          label={t("owner.email")}
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label={t("owner.password")}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          error={failure?.kind === "wrong" ? failure.message : null}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button
          type="submit"
          loading={busy}
          icon={<LogIn aria-hidden="true" />}
          className="w-full"
        >
          {t("owner.loginSubmit")}
        </Button>
        <p className="flex items-center gap-1.5 text-caption text-ink-muted">
          <Lock aria-hidden="true" size={16} />
          {t("owner.loginStaffNote")}
        </p>
      </form>
    </main>
  );
}
