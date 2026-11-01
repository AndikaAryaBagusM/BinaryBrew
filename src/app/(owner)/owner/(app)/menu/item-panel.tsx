"use client";

import { Check } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextAreaField, TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";
import { parseRupiahInput } from "@/lib/money";
import { Notice, SwitchRow, useSignedOutGuard } from "../owner-ui";
import type { OwnerCategoryData, OwnerItemData } from "./menu-screen";

const rupiahDigits = new Intl.NumberFormat("id-ID");

type Draft = {
  name: string;
  categoryId: string;
  price: string;
  description: string;
  isActive: boolean;
  isPromoted: boolean;
};

// O-03 add / edit side panel. Only the fields that changed are sent; the
// server checks every value again and audits the change (FR-OW-02).
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
  const signedOut = useSignedOutGuard();
  const formId = useId();
  const [draft, setDraft] = useState<Draft>(() => ({
    name: item?.name ?? "",
    categoryId: item?.categoryId ?? categories[0]?.id ?? "",
    price: item ? rupiahDigits.format(item.price) : "",
    description: item?.description ?? "",
    isActive: item?.isActive ?? true,
    isPromoted: item?.isPromoted ?? false,
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>(
    {},
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = parseRupiahInput(draft.price);
    const name = draft.name.trim();
    const nextErrors: typeof errors = {};
    if (!name) nextErrors.name = t("owner.nameRequired");
    if (price === null || price > 10_000_000) {
      nextErrors.price = t("owner.priceInvalid");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || price === null) return;

    const values = {
      name,
      categoryId: draft.categoryId,
      price,
      description: draft.description.trim(),
      isActive: draft.isActive,
      isPromoted: draft.isPromoted,
    };
    const body = item
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key, value]) =>
              value !==
              (key === "description"
                ? (item.description ?? "")
                : item[key as keyof typeof values]),
          ),
        )
      : values;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    setFailure(null);
    const result = item
      ? await api(`/api/owner/menu-items/${item.id}`, { method: "PATCH", body })
      : await api("/api/owner/menu-items", { method: "POST", body });
    if (signedOut(result)) return;
    if (!result.ok) {
      setBusy(false);
      setFailure(result.error.message);
      return;
    }
    await onSaved();
    onClose();
  }

  return (
    <Modal
      placement="drawer"
      title={item ? t("owner.editItemTitle") : t("owner.addItem")}
      onClose={onClose}
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        <TextField
          label={t("owner.itemName")}
          value={draft.name}
          maxLength={60}
          required
          error={errors.name}
          onChange={(event) => set("name", event.target.value)}
        />
        <SelectField
          label={t("owner.colCategory")}
          value={draft.categoryId}
          options={categories.map((category) => ({
            value: category.id,
            label: category.isActive
              ? category.name
              : t("owner.categoryOptionInactive", { name: category.name }),
          }))}
          onChange={(event) => set("categoryId", event.target.value)}
        />
        <TextField
          label={t("owner.colPrice")}
          prefix="Rp"
          inputMode="numeric"
          value={draft.price}
          required
          error={errors.price}
          helper={t("owner.priceHelp")}
          onChange={(event) => set("price", event.target.value)}
        />
        <TextAreaField
          label={t("owner.itemDescription")}
          value={draft.description}
          maxLength={200}
          helper={t("owner.itemDescriptionHelp")}
          onChange={(event) => set("description", event.target.value)}
        />
        <SwitchRow
          label={t("owner.itemActive")}
          help={t("owner.itemActiveHelp")}
          checked={draft.isActive}
          onChange={(value) => set("isActive", value)}
        />
        <SwitchRow
          label={t("owner.promote")}
          help={t("owner.promoteHelp")}
          checked={draft.isPromoted}
          onChange={(value) => set("isPromoted", value)}
        />
        <Button
          type="submit"
          loading={busy}
          icon={<Check aria-hidden="true" />}
          className="mt-2 w-full"
        >
          {t("owner.save")}
        </Button>
      </form>
    </Modal>
  );
}
