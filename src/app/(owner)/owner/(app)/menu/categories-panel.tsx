"use client";

import { Check, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { Switch } from "@/components/switch";
import { t } from "@/i18n";
import { api, type ApiResult } from "@/lib/api-client";
import { Notice, useSignedOutGuard } from "../owner-ui";
import type { OwnerCategoryData } from "./menu-screen";

// O-03 categories: add, rename, switch off. Categories are never deleted
// (order history keeps its items); a switched-off category hides its items
// from customers and the Counter.
export function CategoriesPanel({
  categories,
  onChanged,
  onClose,
}: {
  categories: OwnerCategoryData[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const signedOut = useSignedOutGuard();
  const [failure, setFailure] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, request: () => Promise<ApiResult<unknown>>) {
    setBusy(key);
    setFailure(null);
    const result = await request();
    if (signedOut(result)) return false;
    if (!result.ok) setFailure(result.error.message);
    await onChanged();
    setBusy(null);
    return result.ok;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const ok = await run("new", () =>
      api("/api/owner/categories", { method: "POST", body: { name } }),
    );
    if (ok) setNewName("");
  }

  return (
    <Modal
      placement="drawer"
      title={t("owner.categories")}
      description={t("owner.categoriesHelp")}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
        {failure && <Notice tone="danger">{failure}</Notice>}
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
          {categories.map((category) => (
            <CategoryRow
              key={`${category.id}-${category.name}`}
              category={category}
              busy={busy === category.id}
              onRename={(name) =>
                run(category.id, () =>
                  api(`/api/owner/categories/${category.id}`, {
                    method: "PATCH",
                    body: { name },
                  }),
                )
              }
              onActive={(isActive) =>
                run(category.id, () =>
                  api(`/api/owner/categories/${category.id}`, {
                    method: "PATCH",
                    body: { isActive },
                  }),
                )
              }
            />
          ))}
        </ul>
        <form
          onSubmit={(event) => void add(event)}
          className="flex items-end gap-3"
        >
          <TextField
            label={t("owner.newCategory")}
            value={newName}
            maxLength={60}
            onChange={(event) => setNewName(event.target.value)}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="secondary"
            loading={busy === "new"}
            disabled={!newName.trim()}
            icon={<Plus aria-hidden="true" />}
          >
            {t("owner.addCategory")}
          </Button>
        </form>
      </div>
    </Modal>
  );
}

function CategoryRow({
  category,
  busy,
  onRename,
  onActive,
}: {
  category: OwnerCategoryData;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onActive: (isActive: boolean) => Promise<boolean>;
}) {
  const [name, setName] = useState(category.name);
  const renamed = name.trim() !== "" && name.trim() !== category.name;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (renamed) void onRename(name.trim());
        }}
        className="flex items-end gap-3"
      >
        <TextField
          label={t("owner.categoryName")}
          value={name}
          maxLength={60}
          helper={t("owner.categoryItemCount", { n: category.itemCount })}
          onChange={(event) => setName(event.target.value)}
          className="flex-1"
        />
        <div className="flex h-12 items-center gap-3 self-start mt-6">
          {renamed && (
            <Button
              type="submit"
              variant="ghost"
              loading={busy}
              icon={<Check aria-hidden="true" />}
            >
              {t("owner.save")}
            </Button>
          )}
          <Switch
            checked={category.isActive}
            disabled={busy}
            aria-label={t("owner.categoryActive", { name: category.name })}
            onCheckedChange={(isActive) => void onActive(isActive)}
          />
        </div>
      </form>
    </li>
  );
}
