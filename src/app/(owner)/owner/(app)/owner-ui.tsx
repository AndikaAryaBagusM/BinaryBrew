"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useCallback, useId } from "react";
import { Switch } from "@/components/switch";
import type { ApiResult } from "@/lib/api-client";
import { cn } from "@/lib/cn";

// Pieces shared by the owner pages (Figma O-03, O-13, O-14).

export function PageHead({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-60">
        <h1 className="text-h1 text-ink">{title}</h1>
        {subtitle && <p className="text-body text-ink-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-col gap-5 px-4 pt-6 pb-12 sm:px-8 sm:pt-7">
      {children}
    </main>
  );
}

// Owner tables: sunken header row, 56 px rows, a line between rows. Wide
// tables scroll sideways inside their card, never the page (relative: keeps
// the sr-only caption and header text inside the scroller).
export function TableCard({
  label,
  minWidth,
  children,
}: {
  label: string;
  minWidth: string; // Tailwind min-w-* class: below it, the card scrolls
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-x-auto rounded-card border border-line bg-surface">
      <table
        className={cn(
          "w-full table-fixed border-collapse text-left text-owner-body text-ink",
          minWidth,
        )}
      >
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export const thClass =
  "h-11 bg-surface-sunken px-4 text-caption font-medium whitespace-nowrap text-ink-muted";
export const tdClass = "h-14 border-t border-line px-4";

export type TagTone = "ready" | "expired" | "waiting" | "danger" | "info";

const tagTone: Record<TagTone, string> = {
  ready: "bg-status-ready-bg text-status-ready-fg",
  expired: "bg-status-expired-bg text-status-expired-fg",
  waiting: "bg-status-waiting-bg text-status-waiting-fg",
  danger: "bg-status-voided-bg text-status-voided-fg",
  info: "bg-info-soft text-info",
};

export function Tag({
  tone,
  children,
}: {
  tone: TagTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-caption font-medium whitespace-nowrap",
        tagTone[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "success" | "danger";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-card px-4 py-3 text-owner-body font-medium",
        tone === "danger"
          ? "bg-danger-soft text-danger"
          : "bg-success-soft text-success",
      )}
    >
      {children}
    </p>
  );
}

// A 401 or 403 means the owner session ended (logout elsewhere, expiry):
// back to O-01. Returns true when it handled the result.
export function useSignedOutGuard() {
  const router = useRouter();
  return useCallback(
    (result: ApiResult<unknown>) => {
      if (!result.ok && (result.status === 401 || result.status === 403)) {
        router.replace("/owner/login");
        return true;
      }
      return false;
    },
    [router],
  );
}

// A labelled switch with a line of help (O-03 panel, O-14 cards).
export function SwitchRow({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p
          id={`${id}-label`}
          className="text-owner-body font-semibold text-ink"
        >
          {label}
        </p>
        {help && (
          <p id={`${id}-help`} className="text-caption text-ink-muted">
            {help}
          </p>
        )}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
        onCheckedChange={onChange}
      />
    </div>
  );
}

// Tabs of a side panel (O-06 Detail / Resep / Pilihan): the WAI-ARIA tabs
// pattern, arrow keys move between tabs. The caller renders the panel with
// tabPanelProps(idBase, value).
export function Tabs<T extends string>({
  idBase,
  label,
  tabs,
  value,
  onChange,
}: {
  idBase: string;
  label: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length]!;
    onChange(next.id);
    document.getElementById(`${idBase}-tab-${next.id}`)?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 border-b border-line px-6"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={`${idBase}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              "focus-ring -mb-px h-12 cursor-pointer border-b-2 px-3 text-owner-body",
              selected
                ? "border-brand font-semibold text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(idBase: string, value: string) {
  return {
    id: `${idBase}-panel-${value}`,
    role: "tabpanel",
    "aria-labelledby": `${idBase}-tab-${value}`,
    tabIndex: 0,
  } as const;
}

// A small card with a label and a value (O-06 Harga jual / HPP / Margin).
export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <div className="min-w-0 flex-1 rounded-card bg-accent-soft px-3 py-2.5">
      <p className="text-caption text-ink-muted">{label}</p>
      <p
        className={cn(
          "text-owner-body font-semibold",
          tone === "success"
            ? "text-success"
            : tone === "danger"
              ? "text-danger"
              : "text-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}
