import type { Metadata } from "next";
import { Tablet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { t } from "@/i18n";
import { isAppError } from "@/lib/errors";
import {
  deviceTokenFromCookies,
  sessionFromCookies,
} from "@/modules/auth/server";
import { counterSignIn } from "@/modules/auth/service";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// S-01 (FR-POS-03, Flow §5.1): only a registered device lists the staff.
export default function CounterLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <SignIn />
    </Suspense>
  );
}

async function SignIn() {
  if (await sessionFromCookies()) redirect("/counter");
  let data;
  try {
    data = await counterSignIn(await deviceTokenFromCookies());
  } catch (error) {
    if (isAppError(error) && error.code === "DEVICE_NOT_REGISTERED") {
      return <NotRegistered />;
    }
    throw error;
  }
  return <LoginScreen deviceName={data.deviceName} users={data.users} />;
}

function NotRegistered() {
  // The owner registers a browser on O-13; in development the seeded
  // counter device is one click away (docs/02, dev routes).
  const dev =
    process.env.NODE_ENV === "development" &&
    Boolean(process.env.SEED_COUNTER_DEVICE_TOKEN);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4 text-center">
      <BrandWordmark size="l" />
      <Tablet aria-hidden="true" size={44} className="text-ink-muted" />
      <p className="max-w-md text-counter-body text-ink">
        {t("auth.deviceNotRegistered")}
      </p>
      {dev && (
        <Link
          href="/api/dev/counter-device"
          prefetch={false}
          className="focus-ring text-label text-brand underline"
        >
          {t("counter.devRegister")}
        </Link>
      )}
    </main>
  );
}
