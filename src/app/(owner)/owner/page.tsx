import { redirect } from "next/navigation";

// O-02 Dashboard is not built yet; the menu is the owner's home for now.
export default function OwnerHomePage() {
  redirect("/owner/menu");
}
