import type { ApiError, Json } from "@/lib/api-client";
import type { CounterMenu } from "@/modules/menu/service";
import type { CounterOrderDetail } from "@/modules/orders/service";

// Client side of the Counter routes (docs/02 §6); the fetch helper is shared
// with the owner area.
export {
  api,
  type ApiError,
  type ApiResult,
  type Json,
} from "@/lib/api-client";

export type CounterMenuData = Json<CounterMenu>;
export type CounterMenuItemData =
  CounterMenuData["categories"][number]["items"][number];
export type OrderDetailData = Json<CounterOrderDetail>;

// Names of the items in an ITEM_SOLD_OUT refusal.
export function soldOutNames(error: ApiError): string[] {
  const items = error.details?.items;
  return Array.isArray(items)
    ? items.map((item: { name?: string }) => item.name ?? "").filter(Boolean)
    : [];
}
