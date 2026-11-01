"use client";

import { Coffee, LogOut, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { type MessageKey, t } from "@/i18n";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/initials";

// Only the pages that exist are listed; the rest of the Figma nav (Dasbor,
// Bahan & stok, laporan, …) arrives with their tasks.
const sections: {
  label: MessageKey;
  links: { href: string; label: MessageKey; icon: typeof Coffee }[];
}[] = [
  {
    label: "owner.navSectionMenu",
    links: [{ href: "/owner/menu", label: "owner.navMenu", icon: Coffee }],
  },
  {
    label: "owner.navSectionOperations",
    links: [
      { href: "/owner/users", label: "owner.navUsers", icon: Users },
      { href: "/owner/settings", label: "owner.navSettings", icon: Settings },
    ],
  },
];
const links = sections.flatMap((section) => section.links);

export function OwnerNav({ name }: { name: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  async function logout() {
    setLeaving(true);
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/owner/login");
    router.refresh();
  }

  const logoutButton = (
    <button
      type="button"
      aria-label={t("owner.logout")}
      title={t("owner.logout")}
      disabled={leaving}
      onClick={() => void logout()}
      className="focus-ring flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft disabled:opacity-40"
    >
      <LogOut aria-hidden="true" size={20} />
    </button>
  );

  return (
    <>
      {/* Laptop: sidebar (Figma 19:305) */}
      <nav
        aria-label={t("owner.navLabel")}
        className="sticky top-0 hidden h-dvh w-66 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface p-4 lg:flex"
      >
        <div className="px-2 pt-1 pb-3">
          <BrandWordmark />
        </div>
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            <p className="px-3 pt-3 pb-1 text-caption font-medium text-ink-muted uppercase">
              {t(section.label)}
            </p>
            {section.links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "focus-ring flex h-11 items-center gap-3 rounded-[10px] px-3 text-owner-body",
                  isActive(href)
                    ? "bg-accent-soft font-semibold text-brand"
                    : "text-ink-muted hover:bg-surface-sunken",
                )}
              >
                <Icon aria-hidden="true" size={20} />
                {t(label)}
              </Link>
            ))}
          </div>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 rounded-[10px] p-2">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-caption font-medium text-on-brand"
          >
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-owner-body font-semibold text-ink">
              {name}
            </p>
            <p className="text-caption text-ink-muted">
              {t("counter.roleOwner")}
            </p>
          </div>
          {logoutButton}
        </div>
      </nav>

      {/* Phone: top bar and bottom tabs */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <BrandWordmark />
        {logoutButton}
      </header>
      <nav
        aria-label={t("owner.navLabel")}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "focus-ring flex h-16 flex-col items-center justify-center gap-1 px-1 text-center text-caption",
              isActive(href) ? "font-semibold text-brand" : "text-ink-muted",
            )}
          >
            <Icon aria-hidden="true" size={22} />
            {t(label)}
          </Link>
        ))}
      </nav>
    </>
  );
}
