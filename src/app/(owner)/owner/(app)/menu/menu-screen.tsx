"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderCog, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Switch } from "@/components/switch";
import { t } from "@/i18n";
import { api, type ApiResult, type Json } from "@/lib/api-client";
import { formatRupiah } from "@/lib/money";
import { formatTime } from "@/lib/time";
import type { OwnerMenu } from "@/modules/menu/service";
import {
  Notice,
  PageBody,
  PageHead,
  TableCard,
  Tag,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../owner-ui";
import { CategoriesPanel } from "./categories-panel";
import { ItemPanel } from "./item-panel";

export type OwnerMenuData = Json<OwnerMenu>;
export type OwnerItemData = OwnerMenuData["items"][number];
export type OwnerCategoryData = OwnerMenuData["categories"][number];

const MENU_QUERY = ["owner", "menu"] as const;

type Panel =
  { kind: "item"; item: OwnerItemData | null } | { kind: "categories" } | null;

// O-03: one table of every item. "Promosikan" lifts an item in the
// recommendations (D4); "Tandai habis" is the same manual sold-out as the
// Counter's S-08. The HPP column and stock-based statuses arrive in Phase 2.
export function MenuScreen({ initial }: { initial: OwnerMenuData }) {
  const queryClient = useQueryClient();
  const signedOut = useSignedOutGuard();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const { data: menu } = useQuery({
    queryKey: MENU_QUERY,
    queryFn: async () => {
      const result = await api<OwnerMenuData>("/api/owner/menu-items");
      if (signedOut(result)) return initial;
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    initialData: initial,
  });

  const categories = new Map(menu.categories.map((c) => [c.id, c]));
  const needle = query.trim().toLowerCase();
  const items = menu.items.filter((item) =>
    item.name.toLowerCase().includes(needle),
  );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: MENU_QUERY });
  }

  async function toggle(
    key: string,
    request: () => Promise<ApiResult<unknown>>,
  ) {
    setError(null);
    setBusy((current) => new Set(current).add(key));
    const result = await request();
    if (!signedOut(result) && !result.ok) setError(result.error.message);
    await refresh();
    setBusy((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  return (
    <PageBody>
      <PageHead
        title={t("owner.menuTitle")}
        subtitle={t("owner.menuCount", {
          items: menu.items.length,
          categories: menu.categories.length,
        })}
      >
        <TextField
          label={t("owner.search")}
          type="search"
          placeholder={t("owner.menuSearchPlaceholder")}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full sm:w-80"
        />
        <Button
          variant="secondary"
          icon={<FolderCog aria-hidden="true" />}
          onClick={() => setPanel({ kind: "categories" })}
        >
          {t("owner.categories")}
        </Button>
        <Button
          icon={<Plus aria-hidden="true" />}
          onClick={() => setPanel({ kind: "item", item: null })}
        >
          {t("owner.addItem")}
        </Button>
      </PageHead>

      {error && <Notice tone="danger">{error}</Notice>}

      <TableCard label={t("owner.menuTitle")} minWidth="min-w-240">
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              {t("owner.colItem")}
            </th>
            <th scope="col" className={`${thClass} w-30`}>
              {t("owner.colCategory")}
            </th>
            <th scope="col" className={`${thClass} w-28 text-right`}>
              {t("owner.colPrice")}
            </th>
            <th scope="col" className={`${thClass} w-52`}>
              {t("owner.colStatus")}
            </th>
            <th scope="col" className={`${thClass} w-28`}>
              {t("owner.promote")}
            </th>
            <th scope="col" className={`${thClass} w-28`}>
              {t("owner.markSoldOut")}
            </th>
            <th scope="col" className={`${thClass} w-18`}>
              <span className="sr-only">{t("owner.colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className={`${tdClass} text-ink-muted`}>
                {t("owner.menuEmpty")}
              </td>
            </tr>
          )}
          {items.map((item) => {
            const category = categories.get(item.categoryId);
            return (
              // A click anywhere on the row opens the edit panel; keyboard
              // users have the pencil button.
              <tr
                key={item.id}
                onClick={() => setPanel({ kind: "item", item })}
                className="cursor-pointer hover:bg-bg"
              >
                <th scope="row" className={`${tdClass} font-semibold`}>
                  {item.name}
                </th>
                <td className={tdClass}>{category?.name}</td>
                <td className={`${tdClass} text-right whitespace-nowrap`}>
                  {formatRupiah(item.price)}
                </td>
                <td className={tdClass}>
                  <ItemStatus
                    item={item}
                    categoryActive={category?.isActive ?? true}
                  />
                </td>
                <td className={tdClass}>
                  <Switch
                    checked={item.isPromoted}
                    aria-label={t("owner.promoteItem", { name: item.name })}
                    disabled={busy.has(`promote-${item.id}`)}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(isPromoted) =>
                      void toggle(`promote-${item.id}`, () =>
                        api(`/api/owner/menu-items/${item.id}`, {
                          method: "PATCH",
                          body: { isPromoted },
                        }),
                      )
                    }
                  />
                </td>
                <td className={tdClass}>
                  <Switch
                    checked={item.soldOut !== null}
                    aria-label={t("owner.markSoldOutItem", {
                      name: item.name,
                    })}
                    // Only an active item can be sold out (as on S-08).
                    disabled={!item.isActive || busy.has(`sold-${item.id}`)}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(soldOut) =>
                      void toggle(`sold-${item.id}`, () =>
                        api(`/api/counter/menu-items/${item.id}/sold-out`, {
                          method: "POST",
                          body: { soldOut },
                        }),
                      )
                    }
                  />
                </td>
                <td className={tdClass}>
                  <button
                    type="button"
                    aria-label={t("owner.editItem", { name: item.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPanel({ kind: "item", item });
                    }}
                    className="focus-ring flex size-11 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft"
                  >
                    <Pencil aria-hidden="true" size={20} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableCard>

      {panel?.kind === "item" && (
        <ItemPanel
          item={panel.item}
          categories={menu.categories}
          onSaved={refresh}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === "categories" && (
        <CategoriesPanel
          categories={menu.categories}
          onChanged={refresh}
          onClose={() => setPanel(null)}
        />
      )}
    </PageBody>
  );
}

function ItemStatus({
  item,
  categoryActive,
}: {
  item: OwnerItemData;
  categoryActive: boolean;
}) {
  if (!item.isActive) return <Tag tone="expired">{t("owner.inactive")}</Tag>;
  if (!categoryActive) {
    return <Tag tone="expired">{t("owner.categoryInactive")}</Tag>;
  }
  if (item.soldOut) {
    const { byName, at } = item.soldOut;
    return (
      <span className="flex items-center gap-1.5">
        <Tag tone="expired">{t("menu.soldOut")}</Tag>
        <span className="text-caption whitespace-nowrap text-ink-muted">
          {byName && at
            ? t("owner.soldOutManualBy", {
                name: byName,
                time: formatTime(new Date(at)),
              })
            : t("owner.soldOutManual")}
        </span>
      </span>
    );
  }
  return <Tag tone="ready">{t("counter.available")}</Tag>;
}
