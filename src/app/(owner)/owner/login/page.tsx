import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { sessionFromCookies } from "@/modules/auth/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// O-01 (FR-OW-01, Figma 18:3 and 18:45): email and password.
export default function OwnerLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <SignIn />
    </Suspense>
  );
}

async function SignIn() {
  const session = await sessionFromCookies();
  if (session?.role === "owner") redirect("/owner/menu");
  return <LoginForm />;
}
