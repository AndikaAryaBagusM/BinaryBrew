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
import type { SupplierData } from "./ingredients-screen";

// O-05 "Pemasok": add, rename, note, switch off (the same pattern as the O-03
// category panel). Suppliers are never deleted: restocks keep pointing at
// them. They are picked when a restock is recorded (O-07, P2-05).
export function SuppliersPanel({
  suppliers,
  onChanged,
  onClose,
}: {
  suppliers: SupplierData[];
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
      api("/api/owner/suppliers", { method: "POST", body: { name } }),
    );
    if (ok) setNewName("");
  }

  return (
    <Modal
      placement="drawer"
      title={t("owner.suppliers")}
      description={t("owner.suppliersHelp")}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
        {failure && <Notice tone="danger">{failure}</Notice>}
        {suppliers.length === 0 ? (
          <p className="text-owner-body text-ink-muted">
            {t("owner.suppliersEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
            {suppliers.map((supplier) => (
              <SupplierRow
                key={`${supplier.id}-${supplier.name}-${supplier.note ?? ""}`}
                supplier={supplier}
                busy={busy === supplier.id}
                onSave={(patch) =>
                  run(supplier.id, () =>
                    api(`/api/owner/suppliers/${supplier.id}`, {
                      method: "PATCH",
                      body: patch,
                    }),
                  )
                }
              />
            ))}
          </ul>
        )}
        <form
          onSubmit={(event) => void add(event)}
          className="flex items-end gap-3"
        >
          <TextField
            label={t("owner.newSupplier")}
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
            {t("owner.addSupplier")}
          </Button>
        </form>
      </div>
    </Modal>
  );
}

function SupplierRow({
  supplier,
  busy,
  onSave,
}: {
  supplier: SupplierData;
  busy: boolean;
  onSave: (
    patch: Partial<{ name: string; note: string; isActive: boolean }>,
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState(supplier.name);
  const [note, setNote] = useState(supplier.note ?? "");
  const patch = {
    ...(name.trim() !== "" &&
      name.trim() !== supplier.name && { name: name.trim() }),
    ...(note.trim() !== (supplier.note ?? "") && { note: note.trim() }),
  };
  const changed = Object.keys(patch).length > 0;

  return (
    <li className="px-4 py-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) void onSave(patch);
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-end gap-3">
          <TextField
            label={t("owner.supplierName")}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            className="flex-1"
          />
          <div className="mt-6 flex h-12 items-center self-start">
            <Switch
              checked={supplier.isActive}
              disabled={busy}
              aria-label={t("owner.supplierActive", { name: supplier.name })}
              onCheckedChange={(isActive) => void onSave({ isActive })}
            />
          </div>
        </div>
        <TextField
          label={t("owner.supplierNote")}
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
        />
        {changed && (
          <Button
            type="submit"
            variant="ghost"
            loading={busy}
            icon={<Check aria-hidden="true" />}
            className="self-end"
          >
            {t("owner.save")}
          </Button>
        )}
      </form>
    </li>
  );
}
