import { describe, expect, it } from "vitest";
import {
  BOARD_LIMITS,
  boardTiles,
  formatBoardNumber,
  newlyReady,
} from "@/lib/board";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("boardTiles (Design §6.3)", () => {
  it("shows every number up to the limit", () => {
    expect(boardTiles(range(12), BOARD_LIMITS.preparing)).toEqual({
      shown: range(12),
      more: 0,
    });
    expect(boardTiles([], BOARD_LIMITS.ready)).toEqual({ shown: [], more: 0 });
  });

  it("gives the last tile to +N once the column overflows, keeping the order", () => {
    expect(boardTiles(range(7), BOARD_LIMITS.ready)).toEqual({
      shown: [1, 2, 3, 4, 5],
      more: 2,
    });
    expect(boardTiles(range(20), BOARD_LIMITS.preparing)).toEqual({
      shown: range(11),
      more: 9,
    });
  });
});

describe("newlyReady", () => {
  it("lists the numbers that were not in Ready before", () => {
    expect(newlyReady(new Set([4, 5]), [7, 5, 4, 6])).toEqual([7, 6]);
    expect(newlyReady(new Set([4]), [4])).toEqual([]);
  });
});

describe("formatBoardNumber", () => {
  it("pads to three digits without the # sign", () => {
    expect(formatBoardNumber(14)).toBe("014");
    expect(formatBoardNumber(1234)).toBe("1234");
  });
});
