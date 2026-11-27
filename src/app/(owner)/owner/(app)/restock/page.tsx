import { Suspense } from "react";
import { businessDate } from "@/lib/time";
import { getRestockOptions } from "@/modules/inventory/service";
import { asJson, ownerSessionOrLogin } from "../../session";
import { type RestockOptionsData, RestockScreen } from "./restock-screen";

// O-07 Restock entry (FR-IV-05, Figma 20:950).
export default function OwnerRestockPage() {
  return (
    <Suspense fallback={null}>
      <Restock />
    </Suspense>
  );
}

async function Restock() {
  const session = await ownerSessionOrLogin();
  // Same JSON shape as GET /api/counter/restock-options.
  const data = asJson<RestockOptionsData>(await getRestockOptions(session));
  // The shop's calendar date: the default and latest purchase date.
  return (
    <RestockScreen initial={data} today={businessDate(new Date(), "00:00")} />
  );
}
