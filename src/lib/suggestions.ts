import type { Json } from "@/lib/api-client";
import type { PublicMenuItem } from "@/modules/menu/service";
import { type CartLine, selectionProblems } from "@/modules/orders/pricing";
import type { ItemSuggestion } from "@/modules/recommendations/service";

// Client side of the suggestion routes (Flow §7), shared by C-04 and the
// Counter row. Suggestions never block checkout: a failure or an answer
// slower than 1.5 seconds reads as "no suggestions".

export type SuggestionData = Json<ItemSuggestion>;

export const SUGGESTION_TIMEOUT_MS = 1_500;

async function post(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return (await response.json())?.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchSuggestions(
  url: "/api/public/recommendations" | "/api/counter/recommendations",
  body: {
    clientSession: string;
    itemIds: string[];
    shownEventIds?: number[];
  },
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<SuggestionData[]> {
  const data = (await post(url, body, timeoutMs)) as {
    suggestions?: SuggestionData[];
  } | null;
  return data?.suggestions ?? [];
}

// Logs "accepted" or "rejected"; resolves with the new event's id, or null
// when it could not be logged (the order then links the shown event only).
export async function answerSuggestion(
  clientSession: string,
  eventId: number,
  action: "accepted" | "rejected",
  timeoutMs = SUGGESTION_TIMEOUT_MS,
): Promise<number | null> {
  const data = (await post(
    "/api/public/recommendations/events",
    { clientSession, eventId, action },
    timeoutMs,
  )) as { eventId?: number } | null;
  return data?.eventId ?? null;
}

// One of the item with its default options, or null when a required group
// has no default and the options must be chosen first.
export function defaultLine(
  item: Pick<PublicMenuItem, "id" | "name" | "price" | "modifierGroups">,
): CartLine | null {
  const ids = item.modifierGroups.flatMap((group) =>
    group.options.filter((o) => o.isDefault).map((o) => o.id),
  );
  return selectionProblems(item, ids).length === 0
    ? { menuItemId: item.id, quantity: 1, modifierOptionIds: ids }
    : null;
}
