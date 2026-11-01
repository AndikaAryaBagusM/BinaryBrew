import { jsonData, route } from "@/lib/http";
import { getBoard } from "@/modules/orders/service";

// T-01 queue board (FR-QF-04): Preparing and Ready numbers, nothing else.
// Public, never cached.
export const GET = route(async () => {
  const board = await getBoard();
  return jsonData(board, { headers: { "Cache-Control": "no-store" } });
});
