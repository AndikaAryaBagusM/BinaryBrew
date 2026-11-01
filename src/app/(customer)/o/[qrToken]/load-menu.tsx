import type { ReactElement } from "react";
import { EdgeState } from "@/components/edge-state";
import { isAppError } from "@/lib/errors";
import { getPublicMenu, type PublicMenu } from "@/modules/menu/service";

// Shared by C-01 and C-03: the menu for a QR token, or the C-08 state to show
// instead (invalid or rotated code, ordering switched off).
export async function loadMenu(
  qrToken: string,
): Promise<{ menu: PublicMenu } | { edgeState: ReactElement }> {
  try {
    return { menu: await getPublicMenu(qrToken) };
  } catch (error) {
    if (isAppError(error) && error.code === "QR_INVALID") {
      return { edgeState: <EdgeState variant="qrInvalid" /> };
    }
    if (isAppError(error) && error.code === "ORDERING_CLOSED") {
      return { edgeState: <EdgeState variant="closed" /> };
    }
    throw error;
  }
}
