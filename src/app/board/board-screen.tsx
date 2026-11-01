"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Coffee, QrCode, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { t } from "@/i18n";
import {
  BOARD_LIMITS,
  boardTiles,
  formatBoardNumber,
  newlyReady,
} from "@/lib/board";
import { useCurrentSecond } from "@/lib/clock";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/time";
import { useEventStream } from "@/lib/use-event-stream";
import type { Board } from "@/modules/orders/service";

// T-01 (Figma 17:2 default, 17:69 empty, 17:100 reconnecting): Preparing on
// the left, Ready on the right in a brighter panel. Live over SSE with a 10 s
// poll as the safety net; when the stream drops, the numbers stay and a
// "Menyambung ulang…" pill shows until it is back.

const BOARD_KEY = ["board"];
const HIGHLIGHT_MS = 5_000;

async function fetchBoard(): Promise<Board> {
  const response = await fetch("/api/public/board", { cache: "no-store" });
  if (!response.ok) throw new Error(`board: ${response.status}`);
  return (await response.json()).data;
}

export function BoardScreen({ initial }: { initial: Board }) {
  const queryClient = useQueryClient();
  const second = useCurrentSecond();
  const [glowing, setGlowing] = useState<ReadonlySet<number>>(new Set());

  // Numbers already in Ready; anything new in a fetch glows for 5 s.
  const seen = useRef(new Set(initial.ready));
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
    };
  }, []);

  function glow(numbers: number[]) {
    setGlowing((current) => new Set([...current, ...numbers]));
    const id = setTimeout(() => {
      timers.current.delete(id);
      setGlowing((current) => {
        const next = new Set(current);
        for (const number of numbers) next.delete(number);
        return next;
      });
    }, HIGHLIGHT_MS);
    timers.current.add(id);
  }

  const { data: board, isError } = useQuery({
    queryKey: BOARD_KEY,
    queryFn: async () => {
      const board = await fetchBoard();
      const entered = newlyReady(seen.current, board.ready);
      seen.current = new Set(board.ready);
      if (entered.length > 0) glow(entered);
      return board;
    },
    initialData: initial,
    refetchInterval: 10_000,
  });
  const { lost } = useEventStream(
    "/api/stream/board",
    ["change", "sync"],
    () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    },
  );

  const empty = board.preparing.length === 0 && board.ready.length === 0;

  return (
    <div className="flex h-dvh flex-col gap-8 overflow-hidden bg-board-bg px-[3.75vw] pt-12 pb-10 text-board-text">
      <header className="flex items-center gap-6">
        <BrandWordmark size="l" theme="dark" />
        <h1 className="text-board-heading text-board-text-muted">
          {t("board.title")}
        </h1>
        <span className="flex-1" />
        {(lost || isError) && (
          <p
            role="status"
            className="flex items-center gap-3 rounded-full bg-board-tile px-5 py-3 text-board-hint text-board-preparing"
          >
            <WifiOff aria-hidden="true" className="size-7" />
            {t("board.reconnecting")}
          </p>
        )}
        <p className="text-board-heading tabular-nums">
          {second === null ? null : formatTime(new Date(second * 1000))}
        </p>
      </header>

      {empty ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 text-center">
          <h2 className="text-board-heading">{t("board.empty")}</h2>
          <p className="text-board-hint text-board-text-muted">
            {t("board.emptyHint")}
          </p>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[756fr_964fr] gap-14">
          <section
            aria-labelledby="board-preparing"
            className="flex min-h-0 flex-col gap-6"
          >
            <h2
              id="board-preparing"
              className="flex items-center gap-4 text-board-heading"
            >
              <Coffee aria-hidden="true" className="size-[1em] shrink-0" />
              {t("board.preparing")}
            </h2>
            <Tiles
              numbers={board.preparing}
              limit={BOARD_LIMITS.preparing}
              kind="preparing"
              glowing={glowing}
            />
          </section>
          <section
            aria-labelledby="board-ready"
            className="flex min-h-0 flex-col gap-6 rounded-[32px] border-2 border-board-ready bg-board-bg p-8"
          >
            <h2
              id="board-ready"
              className="flex items-center gap-4 text-board-title text-board-ready"
            >
              <Bell aria-hidden="true" className="size-[0.8em] shrink-0" />
              {t("board.ready")}
            </h2>
            <Tiles
              numbers={board.ready}
              limit={BOARD_LIMITS.ready}
              kind="ready"
              glowing={glowing}
            />
          </section>
        </main>
      )}

      <footer className="flex items-center gap-4 pt-2 text-board-hint text-board-text-muted">
        <QrCode aria-hidden="true" className="size-8 shrink-0" />
        {t("board.footer")}
      </footer>
    </div>
  );
}

function Tiles({
  numbers,
  limit,
  kind,
  glowing,
}: {
  numbers: readonly number[];
  limit: number;
  kind: "preparing" | "ready";
  glowing: ReadonlySet<number>;
}) {
  const ready = kind === "ready";
  const { shown, more } = boardTiles(numbers, limit);
  const tile = cn(
    "flex items-center justify-center rounded-[24px]",
    ready ? "bg-board-ready-tile" : "bg-board-tile",
  );
  return (
    <ol
      className={cn(
        "grid min-h-0 flex-1 gap-6",
        ready
          ? "grid-cols-[repeat(2,16.5vw)] grid-rows-3"
          : "grid-cols-[repeat(3,12.3vw)] grid-rows-4",
      )}
    >
      {shown.map((number) => (
        <li
          key={number}
          className={cn(
            tile,
            "tabular-nums",
            ready
              ? "text-board-number text-board-ready"
              : "text-board-number-s text-board-preparing",
            glowing.has(number) &&
              "border-5 border-board-ready shadow-[0_0_16px_rgb(128_209_140/0.45)]",
          )}
        >
          {formatBoardNumber(number)}
        </li>
      ))}
      {more > 0 && (
        <li className={cn(tile, "text-board-heading text-board-text-muted")}>
          {t("board.more", { n: more })}
        </li>
      )}
    </ol>
  );
}
