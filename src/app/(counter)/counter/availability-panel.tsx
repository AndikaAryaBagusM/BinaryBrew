"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/modal";
import { Switch } from "@/components/switch";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/time";
import { api, type CounterMenuData, type CounterMenuItemData } from "./api";

// S-08 Sold-out panel (Figma 16:2925, FR-POS-04, FR-IV-04): one switch per
// item for the manual mark, saying who set it and when. An item whose stock
// cannot cover one serving shows a lock and "Stok habis (otomatis)" with the
// short ingredients; the switch cannot make it available (a restock does), so
// it is disabled unless there is a manual mark left to clear. The customer
// menu and checkout read both on every request.
export function AvailabilityPanel({
  menu,
  onChanged,
  onClose,
  onSignedOut,
}: {
  menu: CounterMenuData;
  onChanged: () => Promise<void>;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const items = menu.categories
    .flatMap((category) => category.items)
    .filter((item) => item.name.toLowerCase().includes(needle));

  async function toggle(item: CounterMenuItemData) {
    setMessage(null);
    setBusy((current) => new Set(current).add(item.id));
    const result = await api(`/api/counter/menu-items/${item.id}/sold-out`, {
      method: "POST",
      body: { soldOut: item.soldOut === null },
    });
    if (!result.ok) {
      if (result.status === 401) return onSignedOut();
      setMessage(result.error.message);
    }
    await onChanged();
    setBusy((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  return (
    <Modal
      title={t("counter.availabilityTitle")}
      description={t("counter.availabilityHelp")}
      placement="drawer"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="menu-search" className="text-label text-ink">
            {t("counter.searchLabel")}
          </label>
          <input
            id="menu-search"
            type="search"
            value={query}
            autoComplete="off"
            placeholder={t("counter.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            className="focus-ring h-14 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-4 text-counter-body text-ink placeholder:text-ink-muted"
          />
        </div>
        {message && (
          <p role="alert" className="text-body font-semibold text-danger">
            {message}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-body text-ink-muted">{t("counter.searchEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
            {items.map((item) => {
              const stockOut = item.stockShort.length > 0;
              return (
                <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p
                      id={`avail-${item.id}`}
                      className="text-counter-body text-ink"
                    >
                      {item.name}
                    </p>
                    <div id={`avail-status-${item.id}`}>
                      {stockOut && (
                        <p className="flex items-center gap-1 text-caption text-danger">
                          <Lock aria-hidden="true" size={14} />
                          {t("counter.stockOut", {
                            items: item.stockShort.join(", "),
                          })}
                        </p>
                      )}
                      {(!stockOut || item.soldOut) && (
                        <p
                          className={cn(
                            "text-caption",
                            item.isAvailable ? "text-ink-muted" : "text-danger",
                          )}
                        >
                          {statusText(item)}
                        </p>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={item.isAvailable}
                    aria-labelledby={`avail-${item.id}`}
                    aria-describedby={`avail-status-${item.id}`}
                    disabled={busy.has(item.id) || (stockOut && !item.soldOut)}
                    onClick={() => void toggle(item)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function statusText(item: CounterMenuItemData): string {
  if (item.isAvailable) return t("counter.available");
  const by = item.soldOut?.byName;
  const at = item.soldOut?.at;
  return by && at
    ? t("counter.markedSoldOutBy", { name: by, time: formatTime(new Date(at)) })
    : t("counter.markedSoldOut");
}
