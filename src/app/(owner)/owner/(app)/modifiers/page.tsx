import { Suspense } from "react";
import { getOwnerIngredients } from "@/modules/inventory/service";
import { getOwnerModifierGroups } from "@/modules/menu/service";
import type { IngredientsData, ModifierGroupData } from "../owner-queries";
import { asJson, ownerSessionOrLogin } from "../../session";
import { ModifiersScreen } from "./modifiers-screen";

// O-04 Modifier groups (FR-OW-03, Figma 19:862).
export default function OwnerModifiersPage() {
  return (
    <Suspense fallback={null}>
      <Modifiers />
    </Suspense>
  );
}

async function Modifiers() {
  const session = await ownerSessionOrLogin();
  // Same JSON shapes as GET /api/owner/modifier-groups and /ingredients.
  const [groups, ingredients] = await Promise.all([
    getOwnerModifierGroups(session),
    getOwnerIngredients(session),
  ]);
  return (
    <ModifiersScreen
      initialGroups={asJson<{ groups: ModifierGroupData[] }>(groups)}
      initialIngredients={asJson<IngredientsData>(ingredients)}
    />
  );
}
