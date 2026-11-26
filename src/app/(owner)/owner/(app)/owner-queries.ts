"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type Json } from "@/lib/api-client";
import type { getOwnerIngredients } from "@/modules/inventory/service";
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
export const MODIFIER_GROUPS_QUERY = ["owner", "modifier-groups"] as const;
export const itemDetailsQuery = (id: string) =>
  ["owner", "menu-item", id] as const;

function useOwnerQuery<T>(key: readonly unknown[], path: string, initial?: T) {
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
  });
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
