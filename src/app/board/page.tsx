import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { QueryProvider } from "@/components/query-provider";
import { getBoard } from "@/modules/orders/service";
import { BoardScreen } from "./board-screen";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// T-01 Queue board (FR-QF-04, Design §6.3): public, for a TV in any
// fullscreen browser. Numbers only, never personal data (D19).
export default function BoardPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-board-bg" />}>
      <Board />
    </Suspense>
  );
}

async function Board() {
  // Live data on every request, never prerendered.
  await connection();
  const initial = await getBoard();
  return (
    <QueryProvider>
      <BoardScreen initial={initial} />
    </QueryProvider>
  );
}
