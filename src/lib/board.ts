// T-01 queue board (Design §6.3, Figma 17:2). Pure helpers for the screen.

// Tiles per column at 1920×1080: Preparing 3 × 4 at 112 px, Ready 2 × 3 at
// 150 px (readable from about 5 m). Beyond that the last tile reads "+N lagi".
export const BOARD_LIMITS = { preparing: 12, ready: 6 } as const;

export function boardTiles(
  numbers: readonly number[],
  limit: number,
): { shown: number[]; more: number } {
  if (numbers.length <= limit) return { shown: [...numbers], more: 0 };
  const shown = numbers.slice(0, limit - 1);
  return { shown, more: numbers.length - shown.length };
}

// Numbers in Ready that were not there before: they glow for 5 s.
export function newlyReady(
  before: ReadonlySet<number>,
  ready: readonly number[],
): number[] {
  return ready.filter((number) => !before.has(number));
}

// "014": the board shows the bare number, large (Figma 6:344).
export function formatBoardNumber(number: number): string {
  return String(number).padStart(3, "0");
}
