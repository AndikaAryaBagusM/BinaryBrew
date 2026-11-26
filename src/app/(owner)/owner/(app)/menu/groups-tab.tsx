"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";
import { groupRuleText } from "../modifiers/labels";
import {
  itemDetailsQuery,
  MODIFIER_GROUPS_QUERY,
  type ModifierGroupData,
  useItemDetails,
  useModifierGroups,
} from "../owner-queries";
import { Notice, Tag, useSignedOutGuard } from "../owner-ui";
import type { OwnerItemData } from "./menu-screen";

// O-06 "Pilihan" (FR-OW-03): which modifier groups the item offers and in
// what order the customer sees them. Groups themselves are edited on O-04.
export function GroupsTab({
  item,
  onSaved,
}: {
  item: OwnerItemData;
  onSaved: () => Promise<void>;
}) {
  const details = useItemDetails(item.id);
  const groups = useModifierGroups();
  if (details.isError || groups.isError) {
    return (
      <div className="px-6 pt-4">
        <Notice tone="danger">{t("error.generic")}</Notice>
      </div>
    );
  }
  if (!details.data || !groups.data) {
    return (
      <p role="status" className="px-6 pt-4 text-owner-body text-ink-muted">
        {t("common.loading")}
      </p>
    );
  }
  return (
    <GroupsEditor
      item={item}
      saved={details.data.groupIds}
      groups={groups.data.groups}
      onSaved={onSaved}
    />
  );
}

function GroupsEditor({
  item,
  saved,
  groups,
  onSaved,
}: {
  item: OwnerItemData;
  saved: string[];
  groups: ModifierGroupData[];
  onSaved: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const signedOut = useSignedOutGuard();
  const [chosen, setChosen] = useState<string[]>(saved);
  const [failure, setFailure] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const byId = new Map(groups.map((group) => [group.id, group]));
  const changed = chosen.join() !== saved.join();
  // Chosen groups first, in the item's order; then the rest.
  const rows = [
    ...chosen.map((id) => byId.get(id)!),
    ...groups.filter((group) => !chosen.includes(group.id)),
  ];

  function update(next: string[]) {
    setSavedNotice(false);
    setChosen(next);
  }

  function moveBy(id: string, step: number) {
    const from = chosen.indexOf(id);
    const to = from + step;
    if (to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    [next[from], next[to]] = [next[to]!, next[from]!];
    update(next);
  }

  async function save() {
    setBusy(true);
    setFailure(null);
    const result = await api(
      `/api/owner/menu-items/${item.id}/modifier-groups`,
      { method: "PUT", body: { groupIds: chosen } },
    );
    if (signedOut(result)) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: itemDetailsQuery(item.id) }),
      queryClient.invalidateQueries({ queryKey: MODIFIER_GROUPS_QUERY }),
      onSaved(),
    ]);
    setSavedNotice(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pt-4 pb-6">
      <p className="text-caption text-ink-muted">{t("owner.groupsHelp")}</p>
      {failure && <Notice tone="danger">{failure}</Notice>}
      {savedNotice && !changed && (
        <Notice tone="success">{t("owner.groupsSaved")}</Notice>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
        {rows.map((group) => {
          const index = chosen.indexOf(group.id);
          const on = index >= 0;
          return (
            <li key={group.id} className="flex items-center gap-3 px-4 py-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    update(
                      on
                        ? chosen.filter((id) => id !== group.id)
                        : [...chosen, group.id],
                    )
                  }
                  className="focus-ring size-5 shrink-0 accent-brand"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-owner-body font-semibold text-ink">
                      {group.name}
                    </span>
                    {!group.isActive && (
                      <Tag tone="expired">{t("owner.inactive")}</Tag>
                    )}
                  </span>
                  <span className="block truncate text-caption text-ink-muted">
                    {groupRuleText(group)} ·{" "}
                    {group.options
                      .filter((option) => option.isActive)
                      .map((option) => option.name)
                      .join(", ")}
                  </span>
                </span>
              </label>
              {on && (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={t("owner.moveUp", { name: group.name })}
                    disabled={index === 0}
                    onClick={() => moveBy(group.id, -1)}
                    className="focus-ring flex size-10 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft disabled:cursor-default disabled:opacity-30"
                  >
                    <ArrowUp aria-hidden="true" size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("owner.moveDown", { name: group.name })}
                    disabled={index === chosen.length - 1}
                    onClick={() => moveBy(group.id, 1)}
                    className="focus-ring flex size-10 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft disabled:cursor-default disabled:opacity-30"
                  >
                    <ArrowDown aria-hidden="true" size={18} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex-1" />
      <Button
        type="button"
        loading={busy}
        disabled={!changed}
        icon={<Check aria-hidden="true" />}
        onClick={() => void save()}
        className="w-full"
      >
        {t("owner.saveGroups")}
      </Button>
    </div>
  );
}
