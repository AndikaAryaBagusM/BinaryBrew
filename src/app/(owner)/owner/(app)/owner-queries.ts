"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type Json } from "@/lib/api-client";
import type {
  getOwnerIngredients,
  LowStockItem,
} from "@/modules/inventory/service";
import type {
  OwnerItemDetails,
  OwnerModifierGroup,
} from "@/modules/menu/service";
import { useSignedOutGuard } from "./owner-ui";

// Owner reads shared by several screens (O-04, O-05, O-06). Always from the
// server (no-store routes); a save invalidates the key.

export type IngredientsData = Json<
  Awaited<ReturnType<typeof getOwnerIngredients>>
>;
export type IngredientData = IngredientsData["ingredients"][number];
export type ModifierGroupData = Json<OwnerModifierGroup>;
export type ModifierOptionData = ModifierGroupData["options"][number];

export const INGREDIENTS_QUERY = ["owner", "ingredients"] as const;
// O-03 list (with each item's HPP, P2-06): a recipe save refreshes it too.
export const MENU_QUERY = ["owner", "menu"] as const;
export const MODIFIER_GROUPS_QUERY = ["owner", "modifier-groups"] as const;
// O-02 "Stok menipis" and the nav badge (P2-07); the owner stream refreshes it.
export const LOW_STOCK_QUERY = ["owner", "low-stock"] as const;
export type LowStockData = { items: Json<LowStockItem>[] };
export const itemDetailsQuery = (id: string) =>
  ["owner", "menu-item", id] as const;

function useOwnerQuery<T>(
  key: readonly unknown[],
  path: string,
  initial?: T,
  refetchInterval?: number,
) {
  const signedOut = useSignedOutGuard();
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await api<T>(path);
      if (signedOut(result)) throw new Error("signed out");
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    ...(initial !== undefined && { initialData: initial }),
    ...(refetchInterval !== undefined && { refetchInterval }),
  });
}

export function useLowStock(initial?: LowStockData, refetchInterval?: number) {
  return useOwnerQuery(
    LOW_STOCK_QUERY,
    "/api/owner/low-stock",
    initial,
    refetchInterval,
  );
}

export function useIngredients(initial?: IngredientsData) {
  return useOwnerQuery(INGREDIENTS_QUERY, "/api/owner/ingredients", initial);
}

export function useModifierGroups(initial?: { groups: ModifierGroupData[] }) {
  return useOwnerQuery(
    MODIFIER_GROUPS_QUERY,
    "/api/owner/modifier-groups",
    initial,
  );
}

export function useItemDetails(id: string) {
  return useOwnerQuery<Json<OwnerItemDetails>>(
    itemDetailsQuery(id),
    `/api/owner/menu-items/${id}`,
  );
}
