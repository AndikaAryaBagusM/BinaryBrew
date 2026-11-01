import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { QueryProvider } from "@/components/query-provider";
import { sessionFromCookies } from "@/modules/auth/server";
import { OwnerNav } from "./owner-nav";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Owner area shell (Design §6.4, Figma O-03 "Nav"): the sidebar on a laptop,
// a top bar and bottom tabs on a phone.
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

// The pages redirect to O-01 without an owner session (a redirect thrown
// here would hide the page from Next's instant-navigation check).
async function Shell({ children }: { children: ReactNode }) {
  const session = await sessionFromCookies();
  if (session?.role !== "owner") return children;
  return (
    <div className="flex min-h-dvh bg-bg">
      <OwnerNav name={session.name} />
      <QueryProvider>
        <div className="min-w-0 flex-1 pt-14 pb-20 lg:pt-0 lg:pb-0">
          {children}
        </div>
      </QueryProvider>
    </div>
  );
}
