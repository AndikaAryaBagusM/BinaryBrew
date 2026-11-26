import { Suspense } from "react";
import { getOwnerIngredients } from "@/modules/inventory/service";
import { asJson, ownerSessionOrLogin } from "../../session";
import { type IngredientsData, IngredientsScreen } from "./ingredients-screen";

// O-05 Ingredients and stock levels (FR-IV-01, Figma 19:1198).
export default function OwnerIngredientsPage() {
  return (
    <Suspense fallback={null}>
      <Ingredients />
    </Suspense>
  );
}

async function Ingredients() {
  const session = await ownerSessionOrLogin();
  // Same JSON shape as GET /api/owner/ingredients.
  const data = asJson<IngredientsData>(await getOwnerIngredients(session));
  return <IngredientsScreen initial={data} />;
}
