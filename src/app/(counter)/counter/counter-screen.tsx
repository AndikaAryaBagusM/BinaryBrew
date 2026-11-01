"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  BellRing,
  ChevronDown,
  Lock,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Button } from "@/components/button";
import { OrderCard } from "@/components/order-card";
import { t, type MessageKey } from "@/i18n";
import { playChime } from "@/lib/chime";
import { cn } from "@/lib/cn";
import {
  formatLockCountdown,
  nextStatus,
  orderAgeMinutes,
  queueCounts,
  type QueueStatus,
  waitingCount,
} from "@/lib/counter-queue";
import { initials } from "@/lib/initials";
import { createLocalStore, useLocalStore } from "@/lib/local-store";
import { formatQueueNumber } from "@/lib/order-display";
import { formatTime } from "@/lib/time";
import { useEventStream } from "@/lib/use-event-stream";
import { api, type CounterMenuData, type CounterMenuItemData } from "./api";
import { AvailabilityPanel } from "./availability-panel";
import { type Charge, ChargeDialog, counterOrderKey } from "./charge-dialog";
import { clearCounterCart } from "./counter-cart";
import { CustomizeDialog } from "./customize-dialog";
import { LockOverlay } from "./lock-overlay";
import { OrderDetail } from "./order-detail";
import { PosPanel, type PosPanelHandle } from "./pos-panel";
import { lockStore, useIdleLock } from "./use-idle-lock";

// S-02 Counter (Figma 14:4, 14:577; Design §6.2, Flow §5): the POS on the
// left (with S-03, S-04, S-05, S-07 and the S-08 sold-out panel) and the
// queue column, which updates over SSE with a 10 s poll as the safety net. A
// new paid order chimes, gets an accent border for 5 s and a toast. Status
// buttons move an order one step at once and roll back if the server says
// no; tapping a card opens S-06.

// GET /api/counter/orders, as JSON.
export type CounterOrderData = {
  id: string;
  queueNumber: number;
  status: QueueStatus;
  channel: "self_order" | "counter";
  paidAt: string;
  preparingAt: string | null;
  readyAt: string | null;
  items: { name: string; quantity: number; options: string[] }[];
};

type Filter = "all" | QueueStatus;
const filters: { value: Filter; label: MessageKey }[] = [
  { value: "all", label: "counter.filterAll" },
  { value: "paid", label: "counter.filterPaid" },
  { value: "preparing", label: "counter.filterPreparing" },
  { value: "ready", label: "counter.filterReady" },
];

const QUEUE_KEY = ["counter-queue"];
const MENU_KEY = ["counter-menu"];
const HIGHLIGHT_MS = 5_000;
const ALERT_MS = 4_000;

const muteStore = createLocalStore("bb.counterMuted");

// Wall clock for the order ages; null on the server and before mounting, so
// hydration never sees a different minute.
let clockNow = 0;
const subscribeClock = (onTick: () => void) => {
  const tick = () => {
    clockNow = Date.now();
    onTick();
  };
  tick();
  const id = setInterval(tick, 15_000);
  return () => clearInterval(id);
};
function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow || null,
    () => null,
  );
}

class SignedOut extends Error {}

async function fetchQueue(): Promise<CounterOrderData[]> {
  const response = await fetch("/api/counter/orders", { cache: "no-store" });
  if (response.status === 401) throw new SignedOut();
  if (!response.ok) throw new Error(`queue: ${response.status}`);
  return (await response.json()).data.orders;
}

export function CounterScreen({
  user,
  initial,
  initialMenu,
  mockPay,
}: {
  user: { name: string; sessionId: string };
  initial: CounterOrderData[];
  initialMenu: CounterMenuData;
  mockPay: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const muted = useLocalStore(muteStore) === "1";
  const { locked, remainingMs, lock, unlock } = useIdleLock(user.sessionId);
  const now = useNow();

  const [filter, setFilter] = useState<Filter>("all");
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<CounterOrderData | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [alert, setAlert] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customizing, setCustomizing] = useState<CounterMenuItemData | null>(
    null,
  );
  const [charge, setCharge] = useState<Charge | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const pos = useRef<PosPanelHandle>(null);

  // Orders already on screen; anything else in a fetch is an arrival.
  const seen = useRef(new Set(initial.map((order) => order.id)));
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
    };
  }, []);
  function later(run: () => void, ms: number) {
    const id = setTimeout(() => {
      timers.current.delete(id);
      run();
    }, ms);
    timers.current.add(id);
  }

  function goToLogin() {
    lockStore.set(null);
    clearCounterCart();
    router.replace("/counter/login");
  }

  function arrived(orders: CounterOrderData[]) {
    const ids = new Set(orders.map((order) => order.id));
    setFresh((current) => new Set([...current, ...ids]));
    setToast(orders.at(-1)!);
    later(() => {
      setFresh((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
      setToast((current) => (current && ids.has(current.id) ? null : current));
    }, HIGHLIGHT_MS);
    // Also while locked (E11). Browsers allow sound after the first touch.
    if (muteStore.get() !== "1" && navigator.userActivation?.hasBeenActive) {
      playChime();
    }
  }

  const { data: orders } = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => {
      let orders: CounterOrderData[];
      try {
        orders = await fetchQueue();
      } catch (error) {
        if (error instanceof SignedOut) goToLogin();
        throw error;
      }
      const added = orders.filter((order) => !seen.current.has(order.id));
      for (const order of orders) seen.current.add(order.id);
      if (added.length > 0) arrived(added);
      return orders;
    },
    initialData: initial,
    refetchInterval: 10_000,
  });
  // Prices and availability: the server's on every fetch, never cached
  // across requests; S-08 and a sold-out refusal refetch at once.
  const { data: menu } = useQuery({
    queryKey: MENU_KEY,
    queryFn: async () => {
      const result = await api<CounterMenuData>("/api/counter/menu");
      if (result.ok) return result.data;
      if (result.status === 401) goToLogin();
      throw new Error(result.error.message);
    },
    initialData: initialMenu,
    refetchInterval: 30_000,
  });
  const refreshMenu = () =>
    queryClient.invalidateQueries({ queryKey: MENU_KEY });

  useEventStream("/api/stream/counter", ["order", "sync"], () => {
    void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    void queryClient.invalidateQueries({ queryKey: ["counter-order"] });
  });

  function showAlert(message: string) {
    setAlert(message);
    later(
      () => setAlert((current) => (current === message ? null : current)),
      ALERT_MS,
    );
  }

  async function advance(order: CounterOrderData) {
    const step = nextStatus(order.status);
    setBusy((current) => new Set(current).add(order.id));
    await queryClient.cancelQueries({ queryKey: QUEUE_KEY });
    const previous = queryClient.getQueryData<CounterOrderData[]>(QUEUE_KEY);
    queryClient.setQueryData<CounterOrderData[]>(QUEUE_KEY, (current = []) =>
      step.status === "completed"
        ? current.filter((each) => each.id !== order.id)
        : current.map((each) =>
            each.id === order.id ? { ...each, status: step.status } : each,
          ),
    );
    try {
      const response = await fetch(`/api/counter/orders/${order.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: step.status }),
      });
      if (response.status === 401) {
        goToLogin();
        return;
      }
      if (!response.ok) {
        const error = (await response.json().catch(() => null))?.error;
        queryClient.setQueryData(QUEUE_KEY, previous);
        showAlert(error?.message ?? t("error.generic"));
      }
    } catch {
      queryClient.setQueryData(QUEUE_KEY, previous);
      showAlert(t("error.generic"));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    }
  }

  // The step button in S-06: the same optimistic move as on the card.
  async function advanceFromDetail(orderId: string) {
    const order = queryClient
      .getQueryData<CounterOrderData[]>(QUEUE_KEY)
      ?.find((each) => each.id === orderId);
    if (order) await advance(order);
    await queryClient.invalidateQueries({ queryKey: counterOrderKey(orderId) });
  }

  function show(orderId: string) {
    setFilter("all");
    setToast(null);
    // After the filter change has rendered.
    requestAnimationFrame(() => {
      const target = document.getElementById(`order-${orderId}`);
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    });
  }

  async function switchUser() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // The login page still asks for a PIN; the session ends in 12 h.
    }
    goToLogin();
  }

  const counts = queueCounts(orders);
  const visible =
    filter === "all" ? orders : orders.filter((each) => each.status === filter);
  const oldestId = orders.length >= 2 ? orders[0]!.id : null;
  const newest = orders.findLast((each) => fresh.has(each.id));

  return (
    <>
      <div inert={locked} className="flex h-dvh flex-col bg-bg">
        <header className="flex h-18 shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
          <BrandWordmark />
          <StaffMenu
            name={user.name}
            remainingMs={remainingMs}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onLock={() => {
              setMenuOpen(false);
              lock();
            }}
            onSwitchUser={() => void switchUser()}
          />
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setAvailabilityOpen(true)}
            className="focus-ring flex h-14 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-5 text-counter-label text-ink active:bg-accent-soft"
          >
            <Ban aria-hidden="true" size={22} />
            {t("counter.soldOutButton")}
          </button>
          {newest ? (
            <button
              type="button"
              onClick={() => show(newest.id)}
              className="focus-ring flex h-12 cursor-pointer items-center gap-2 rounded-full bg-accent px-4 text-counter-label text-ink"
            >
              <BellRing aria-hidden="true" size={22} />
              {t("counter.newOrderBadge")}
            </button>
          ) : (
            <Button
              variant="ghost"
              size="counter"
              icon={
                muted ? (
                  <VolumeX aria-hidden="true" />
                ) : (
                  <Volume2 aria-hidden="true" />
                )
              }
              onClick={() => muteStore.set(muted ? null : "1")}
            >
              {t(muted ? "counter.soundOff" : "counter.soundOn")}
            </Button>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          <PosPanel
            ref={pos}
            menu={menu}
            onCustomize={setCustomizing}
            onCharge={setCharge}
            onMenuStale={() => void refreshMenu()}
            onSignedOut={goToLogin}
          />

          <aside
            aria-labelledby="queue-title"
            className="relative flex w-[40%] flex-col gap-4 border-l border-line bg-surface-sunken p-5"
          >
            <div className="flex items-baseline gap-3">
              <h2 id="queue-title" className="text-counter-title text-ink">
                {t("counter.queue")}
              </h2>
              <p className="text-body text-ink-muted">
                {t("counter.queueMeta", { n: orders.length })}
              </p>
            </div>
            <div
              role="group"
              aria-label={t("counter.filterLabel")}
              className="flex flex-wrap gap-2"
            >
              {filters.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    "focus-ring flex h-12 cursor-pointer items-center gap-2 rounded-full border px-4 text-counter-label transition-colors duration-100",
                    filter === value
                      ? "border-brand bg-brand text-on-brand"
                      : "border-line bg-surface text-ink",
                  )}
                >
                  {t(label)}
                  <span className="tabular-nums">
                    {value === "all" ? orders.length : counts[value]}
                  </span>
                </button>
              ))}
            </div>
            {alert && (
              <p
                role="alert"
                className="rounded-card bg-danger-soft px-4 py-3 text-counter-body text-danger"
              >
                {alert}
              </p>
            )}
            {visible.length === 0 ? (
              <p className="py-10 text-center text-counter-body text-ink-muted">
                {t(
                  orders.length === 0
                    ? "counter.emptyQueue"
                    : "counter.emptyFilter",
                )}
              </p>
            ) : (
              <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-24">
                {visible.map((order) => (
                  <li
                    key={order.id}
                    id={`order-${order.id}`}
                    tabIndex={-1}
                    className="rounded-[14px] outline-none"
                  >
                    <OrderCard
                      queueNumber={order.queueNumber}
                      status={order.status}
                      ageMinutes={
                        now === null ? null : orderAgeMinutes(order.paidAt, now)
                      }
                      items={order.items}
                      isNew={fresh.has(order.id)}
                      oldest={order.id === oldestId}
                      busy={busy.has(order.id)}
                      onAdvance={() => void advance(order)}
                      onOpen={() => setDetailId(order.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {toast && (
              <div
                role="status"
                className="absolute inset-x-5 bottom-5 flex items-center gap-4 rounded-[14px] bg-ink p-4 text-on-brand shadow-dialog"
              >
                <BellRing
                  aria-hidden="true"
                  size={24}
                  className="text-accent"
                />
                <div className="flex-1">
                  <p className="text-counter-label">
                    {t("counter.newOrderTitle", {
                      number: formatQueueNumber(toast.queueNumber),
                    })}
                  </p>
                  <p className="text-body">
                    {t("counter.newOrderMeta", {
                      n: toast.items.reduce(
                        (sum, item) => sum + item.quantity,
                        0,
                      ),
                      time: formatTime(new Date(toast.paidAt)),
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => show(toast.id)}
                  className="focus-ring h-12 cursor-pointer rounded-card bg-accent px-4 text-counter-label text-ink"
                >
                  {t("counter.view")}
                </button>
              </div>
            )}
          </aside>
        </div>
      </div>
      {/* Dialogs wait under the lock: two modal layers fight over focus. */}
      {!locked && customizing && (
        <CustomizeDialog
          item={customizing}
          onClose={() => setCustomizing(null)}
          onAdd={(line) => {
            pos.current?.add(line);
            setCustomizing(null);
          }}
        />
      )}
      {!locked && charge && (
        <ChargeDialog
          key={charge.id}
          charge={charge}
          needsOwnerPin={menu.manualPaymentNeedsOwnerPin}
          mockPay={mockPay}
          onPaid={() => {
            clearCounterCart();
            void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
          }}
          onRetry={() => {
            setCharge(null);
            pos.current?.charge();
          }}
          onClose={() => setCharge(null)}
          onSignedOut={goToLogin}
        />
      )}
      {!locked && detailId && (
        <OrderDetail
          orderId={detailId}
          onAdvance={(order) => advanceFromDetail(order.id)}
          onClose={() => setDetailId(null)}
          onSignedOut={goToLogin}
        />
      )}
      {!locked && availabilityOpen && (
        <AvailabilityPanel
          menu={menu}
          onChanged={refreshMenu}
          onClose={() => setAvailabilityOpen(false)}
          onSignedOut={goToLogin}
        />
      )}
      {locked && (
        <LockOverlay
          name={user.name}
          waiting={waitingCount(orders)}
          muted={muted}
          onUnlock={unlock}
          onSwitchUser={() => void switchUser()}
        />
      )}
    </>
  );
}

function StaffMenu({
  name,
  remainingMs,
  open,
  onOpenChange,
  onLock,
  onSwitchUser,
}: {
  name: string;
  remainingMs: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLock: () => void;
  onSwitchUser: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onOpenChange]);

  const itemClass =
    "focus-ring flex h-14 w-full cursor-pointer items-center gap-3 px-4 text-left text-counter-body text-ink active:bg-accent-soft";
  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("counter.staffMenu")}: ${name}`}
        onClick={() => onOpenChange(!open)}
        className="focus-ring flex h-14 cursor-pointer items-center gap-3 rounded-full border border-line bg-surface py-1 pr-4 pl-1"
      >
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-counter-label text-brand"
        >
          {initials(name)}
        </span>
        <span className="flex flex-col items-start">
          <span className="text-counter-label text-ink">{name}</span>
          {remainingMs !== null && (
            <span className="text-caption text-ink-muted tabular-nums">
              {t("counter.lockIn", { time: formatLockCountdown(remainingMs) })}
            </span>
          )}
        </span>
        <ChevronDown aria-hidden="true" size={20} className="text-ink-muted" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-40 mt-2 w-64 overflow-hidden rounded-card border border-line bg-surface shadow-dialog"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={onLock}
          >
            <Lock aria-hidden="true" size={22} />
            {t("counter.lockNow")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={onSwitchUser}
          >
            <Users aria-hidden="true" size={22} />
            {t("counter.switchUser")}
          </button>
        </div>
      )}
    </div>
  );
}
