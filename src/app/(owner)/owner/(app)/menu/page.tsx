import { Suspense } from "react";
import { getOwnerMenu } from "@/modules/menu/service";
import { asJson, ownerSessionOrLogin } from "../../session";
import { MenuScreen, type OwnerMenuData } from "./menu-screen";

// O-03 Menu management (FR-OW-02, FR-RC-05, Figma 19:304).
export default function OwnerMenuPage() {
  return (
    <Suspense fallback={null}>
      <Menu />
    </Suspense>
  );
}

async function Menu() {
  const session = await ownerSessionOrLogin();
  // Same JSON shape as GET /api/owner/menu-items.
  const menu = asJson<OwnerMenuData>(await getOwnerMenu(session));
  return <MenuScreen initial={menu} />;
}
