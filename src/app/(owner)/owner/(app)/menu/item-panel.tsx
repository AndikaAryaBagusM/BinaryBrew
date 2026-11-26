"use client";

import { useId, useState } from "react";
import { Modal } from "@/components/modal";
import { t } from "@/i18n";
import { tabPanelProps, Tabs } from "../owner-ui";
import { GroupsTab } from "./groups-tab";
import { ItemDetailForm } from "./item-detail-form";
import type { OwnerCategoryData, OwnerItemData } from "./menu-screen";
import { RecipeTab } from "./recipe-tab";

type Tab = "detail" | "recipe" | "groups";

// O-03 add form and the O-06 side panel of an existing item (Figma 19:1632):
// Detail, Resep (recipe with live HPP and margin, FR-IV-02) and Pilihan (the
// modifier groups it offers, FR-OW-03). A new item gets its recipe and
// groups after it is saved.
export function ItemPanel({
  item,
  categories,
  onSaved,
  onClose,
}: {
  item: OwnerItemData | null;
  categories: OwnerCategoryData[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const idBase = useId();
  const [tab, setTab] = useState<Tab>("detail");

  if (!item) {
    return (
      <Modal placement="drawer" title={t("owner.addItem")} onClose={onClose}>
        <ItemDetailForm
          item={null}
          categories={categories}
          onSaved={onSaved}
          onClose={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal placement="drawer" title={item.name} onClose={onClose}>
      <div className="pt-3">
        <Tabs
          idBase={idBase}
          label={t("owner.itemTabsLabel")}
          tabs={[
            { id: "detail", label: t("owner.tabDetail") },
            { id: "recipe", label: t("owner.tabRecipe") },
            { id: "groups", label: t("owner.tabGroups") },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div {...tabPanelProps(idBase, tab)} className="flex flex-1 flex-col">
        {tab === "detail" && (
          <ItemDetailForm
            item={item}
            categories={categories}
            onSaved={onSaved}
            onClose={onClose}
          />
        )}
        {tab === "recipe" && <RecipeTab item={item} />}
        {tab === "groups" && <GroupsTab item={item} onSaved={onSaved} />}
      </div>
    </Modal>
  );
}
