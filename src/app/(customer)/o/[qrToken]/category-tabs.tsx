"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

// Sticky, horizontally scrolling category tabs (Design §5). Plain anchor
// links, so they work before hydration; the selected tab follows the
// section in view and gets the accent underline.
export function CategoryTabs({
  categories,
}: {
  categories: { id: string; name: string }[];
}) {
  const [active, setActive] = useState(categories[0]?.id);
  const tabs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActive(visible.target.id.replace("kategori-", ""));
      },
      // A section is current while it crosses the band just under the tabs.
      { rootMargin: "-120px 0px -70% 0px" },
    );
    for (const { id } of categories) {
      const section = document.getElementById(`kategori-${id}`);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [categories]);

  useEffect(() => {
    tabs.current
      ?.querySelector("[aria-current=true]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <nav
      aria-label={t("menu.categoriesLabel")}
      className="border-b border-line"
    >
      <div
        ref={tabs}
        className="flex gap-1 overflow-x-auto px-2 [scrollbar-width:none]"
      >
        {categories.map(({ id, name }) => (
          <a
            key={id}
            href={`#kategori-${id}`}
            aria-current={id === active ? "true" : undefined}
            onClick={() => setActive(id)}
            className={cn(
              "focus-ring flex min-h-11 shrink-0 items-center border-b-[3px] px-3 text-label whitespace-nowrap",
              id === active
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted",
            )}
          >
            {name}
          </a>
        ))}
      </div>
    </nav>
  );
}
