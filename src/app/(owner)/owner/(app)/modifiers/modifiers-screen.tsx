"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Info, Pencil, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { Switch } from "@/components/switch";
import { t } from "@/i18n";
import { api, type ApiResult } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPriceDelta } from "@/lib/money";
import {
  type IngredientsData,
  MODIFIER_GROUPS_QUERY,
  type ModifierGroupData,
  type ModifierOptionData,
  useIngredients,
  useModifierGroups,
} from "../owner-queries";
import {
  Notice,
  PageBody,
  PageHead,
  Tag,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../owner-ui";
import { deltaText, groupRuleText } from "./labels";
import { OptionPanel } from "./option-panel";

type Panel =
  | { kind: "group" }
  | { kind: "option"; option: ModifierOptionData | null }
  | null;

// 0–10, the API limit of min_select and max_select.
function parseCount(text: string): number | null {
  return /^\s*\d{1,2}\s*$/.test(text) && Number(text) <= 10
    ? Number(text)
    : null;
}

// O-04 "Pilihan menu" (FR-OW-03, Figma 19:862): the groups on the left, the
// chosen group on the right with its limits, its options (price change and
// stock effect per serving) and the items that offer it. Groups and options
// are switched off, never deleted: order history keeps their names.
export function ModifiersScreen({
  initialGroups,
  initialIngredients,
}: {
  initialGroups: { groups: ModifierGroupData[] };
  initialIngredients: IngredientsData;
}) {
  const queryClient = useQueryClient();
  const { data } = useModifierGroups(initialGroups);
  const { data: ingredientData } = useIngredients(initialIngredients);
  const groups = data?.groups ?? initialGroups.groups;
  const ingredients = (ingredientData ?? initialIngredients).ingredients;
  const [selectedId, setSelectedId] = useState(groups[0]?.id ?? null);
  const [panel, setPanel] = useState<Panel>(null);
  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const ingredientsById = new Map(ingredients.map((i) => [i.id, i]));

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: MODIFIER_GROUPS_QUERY });
  }

  return (
    <PageBody>
      <PageHead
        title={t("owner.modifiersTitle")}
        subtitle={t("owner.modifiersSubtitle")}
      >
        <Button
          icon={<Plus aria-hidden="true" />}
          onClick={() => setPanel({ kind: "group" })}
        >
          {t("owner.addGroup")}
        </Button>
      </PageHead>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <ul
          aria-label={t("owner.modifiersTitle")}
          className="flex flex-col gap-3 lg:w-80 lg:shrink-0"
        >
          {groups.map((group) => {
            const stockFree = group.options.every(
              (option) => option.ingredientDeltas.length === 0,
            );
            const current = group.id === selectedId;
            return (
              <li key={group.id}>
                <button
                  type="button"
                  aria-pressed={current}
                  onClick={() => setSelectedId(group.id)}
                  className={cn(
                    "focus-ring flex w-full cursor-pointer flex-col items-start gap-1 rounded-card border bg-surface px-4 py-3 text-left",
                    current
                      ? "border-2 border-brand bg-accent-soft"
                      : "border-line hover:bg-bg",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-h3 text-ink">{group.name}</span>
                    {!group.isActive && (
                      <Tag tone="expired">{t("owner.inactive")}</Tag>
                    )}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {groupRuleText(group)} ·{" "}
                    {t("owner.groupUsedIn", { n: group.items.length })}
                  </span>
                  {stockFree && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-caption text-ink-muted">
                      <Info aria-hidden="true" size={14} />
                      {t("owner.noStockEffect")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {groups.length === 0 && (
            <li className="text-owner-body text-ink-muted">
              {t("owner.groupsEmpty")}
            </li>
          )}
        </ul>

        {selected && (
          <GroupDetail
            key={`${selected.id}-${selected.name}-${selected.minSelect}-${selected.maxSelect}`}
            group={selected}
            ingredientsById={ingredientsById}
            onChanged={refresh}
            onEditOption={(option) => setPanel({ kind: "option", option })}
          />
        )}
      </div>

      {panel?.kind === "group" && (
        <NewGroupPanel
          onCreated={async (id) => {
            await refresh();
            setSelectedId(id);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === "option" && selected && (
        <OptionPanel
          group={selected}
          option={panel.option}
          ingredients={ingredients}
          onSaved={refresh}
          onClose={() => setPanel(null)}
        />
      )}
    </PageBody>
  );
}

function GroupDetail({
  group,
  ingredientsById,
  onChanged,
  onEditOption,
}: {
  group: ModifierGroupData;
  ingredientsById: ReadonlyMap<string, { name: string; unit: string }>;
  onChanged: () => Promise<void>;
  onEditOption: (option: ModifierOptionData | null) => void;
}) {
  const signedOut = useSignedOutGuard();
  const [name, setName] = useState(group.name);
  const [min, setMin] = useState(String(group.minSelect));
  const [max, setMax] = useState(String(group.maxSelect));
  const [errors, setErrors] = useState<{ min?: string; max?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = {
    ...(name.trim() !== "" &&
      name.trim() !== group.name && {
        name: name.trim(),
      }),
    ...(parseCount(min) !== group.minSelect && { minSelect: parseCount(min) }),
    ...(parseCount(max) !== group.maxSelect && { maxSelect: parseCount(max) }),
  };
  const changed = Object.keys(patch).length > 0;

  async function run(key: string, request: () => Promise<ApiResult<unknown>>) {
    setBusy(key);
    setFailure(null);
    const result = await request();
    if (signedOut(result)) return;
    if (!result.ok) setFailure(result.error.message);
    await onChanged();
    setBusy(null);
  }

  function saveLimits(event: FormEvent) {
    event.preventDefault();
    const minSelect = parseCount(min);
    const maxSelect = parseCount(max);
    const next: typeof errors = {};
    if (minSelect === null) next.min = t("owner.countInvalid");
    if (maxSelect === null || maxSelect < 1) next.max = t("owner.countInvalid");
    else if (minSelect !== null && minSelect > maxSelect) {
      next.min = t("owner.minAboveMax");
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !changed) return;
    void run("group", () =>
      api(`/api/owner/modifier-groups/${group.id}`, {
        method: "PATCH",
        body: patch,
      }),
    );
  }

  return (
    <section
      aria-label={group.name}
      className="flex min-w-0 flex-1 flex-col gap-5 rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 flex-1 text-h2 text-ink">{group.name}</h2>
        <span className="text-caption text-ink-muted" aria-hidden="true">
          {t("owner.active")}
        </span>
        <Switch
          checked={group.isActive}
          disabled={busy !== null}
          aria-label={t("owner.groupActive", { name: group.name })}
          onCheckedChange={(isActive) =>
            void run("active", () =>
              api(`/api/owner/modifier-groups/${group.id}`, {
                method: "PATCH",
                body: { isActive },
              }),
            )
          }
        />
      </div>
      {failure && <Notice tone="danger">{failure}</Notice>}

      <form
        noValidate
        onSubmit={saveLimits}
        className="flex flex-wrap items-start gap-3"
      >
        <TextField
          label={t("owner.groupName")}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          className="min-w-48 flex-1"
        />
        <TextField
          label={t("owner.minSelect")}
          inputMode="numeric"
          value={min}
          error={errors.min}
          onChange={(event) => setMin(event.target.value)}
          className="w-32"
        />
        <TextField
          label={t("owner.maxSelect")}
          inputMode="numeric"
          value={max}
          error={errors.max}
          onChange={(event) => setMax(event.target.value)}
          className="w-32"
        />
        {changed && (
          <Button
            type="submit"
            variant="secondary"
            loading={busy === "group"}
            icon={<Check aria-hidden="true" />}
            className="mt-6"
          >
            {t("owner.save")}
          </Button>
        )}
      </form>

      <div className="relative overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-150 table-fixed border-collapse text-left text-owner-body text-ink">
          <caption className="sr-only">
            {t("owner.optionsOf", { name: group.name })}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={`${thClass} w-36`}>
                {t("owner.colOption")}
              </th>
              <th scope="col" className={`${thClass} w-32 text-right`}>
                {t("owner.colPriceDelta")}
              </th>
              <th scope="col" className={thClass}>
                {t("owner.colStockEffect")}
              </th>
              <th scope="col" className={`${thClass} w-20`}>
                {t("owner.active")}
              </th>
              <th scope="col" className={`${thClass} w-16`}>
                <span className="sr-only">{t("owner.colActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {group.options.length === 0 && (
              <tr>
                <td colSpan={5} className={`${tdClass} text-ink-muted`}>
                  {t("owner.optionsEmpty")}
                </td>
              </tr>
            )}
            {group.options.map((option) => (
              <tr
                key={option.id}
                className={cn(!option.isActive && "text-ink-muted")}
              >
                <th scope="row" className={`${tdClass} font-semibold`}>
                  {option.name}
                  {option.isDefault && (
                    <span className="block text-caption font-normal text-ink-muted">
                      {t("owner.optionDefault")}
                    </span>
                  )}
                </th>
                <td className={`${tdClass} text-right whitespace-nowrap`}>
                  {formatPriceDelta(option.priceDelta) || "—"}
                </td>
                <td className={tdClass}>
                  {option.ingredientDeltas.length > 0
                    ? deltaText(option.ingredientDeltas, ingredientsById)
                    : "—"}
                </td>
                <td className={tdClass}>
                  <Switch
                    checked={option.isActive}
                    disabled={busy !== null}
                    aria-label={t("owner.optionActive", { name: option.name })}
                    onCheckedChange={(isActive) =>
                      void run(option.id, () =>
                        api(`/api/owner/modifier-options/${option.id}`, {
                          method: "PATCH",
                          body: { isActive },
                        }),
                      )
                    }
                  />
                </td>
                <td className={tdClass}>
                  <button
                    type="button"
                    aria-label={t("owner.editItem", { name: option.name })}
                    onClick={() => onEditOption(option)}
                    className="focus-ring flex size-11 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft"
                  >
                    <Pencil aria-hidden="true" size={20} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        variant="ghost"
        icon={<Plus aria-hidden="true" />}
        onClick={() => onEditOption(null)}
        className="self-start"
      >
        {t("owner.addOption")}
      </Button>

      <div className="flex flex-col gap-2">
        <h3 className="text-owner-body font-semibold text-ink">
          {t("owner.usedInMenu")}
        </h3>
        {group.items.length === 0 ? (
          <p className="text-caption text-ink-muted">
            {t("owner.notUsedInMenu")}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {group.items.map((item) => (
              <li
                key={item.id}
                className="rounded-full bg-surface-sunken px-3 py-1 text-caption text-ink"
              >
                {item.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NewGroupPanel({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const signedOut = useSignedOutGuard();
  const [name, setName] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("1");
  const [errors, setErrors] = useState<{
    name?: string;
    min?: string;
    max?: string;
  }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minSelect = parseCount(min);
    const maxSelect = parseCount(max);
    const next: typeof errors = {};
    if (!name.trim()) next.name = t("owner.nameRequired");
    if (minSelect === null) next.min = t("owner.countInvalid");
    if (maxSelect === null || maxSelect < 1) next.max = t("owner.countInvalid");
    else if (minSelect !== null && minSelect > maxSelect) {
      next.min = t("owner.minAboveMax");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setFailure(null);
    const result = await api<{ id: string }>("/api/owner/modifier-groups", {
      method: "POST",
      body: { name: name.trim(), minSelect, maxSelect },
    });
    if (signedOut(result)) return;
    if (!result.ok) {
      setBusy(false);
      setFailure(result.error.message);
      return;
    }
    await onCreated(result.data.id);
    onClose();
  }

  return (
    <Modal
      placement="drawer"
      title={t("owner.addGroup")}
      description={t("owner.groupLimitsHelp")}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        <TextField
          label={t("owner.groupName")}
          value={name}
          maxLength={60}
          required
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t("owner.minSelect")}
          inputMode="numeric"
          value={min}
          error={errors.min}
          helper={t("owner.minSelectHelp")}
          onChange={(event) => setMin(event.target.value)}
        />
        <TextField
          label={t("owner.maxSelect")}
          inputMode="numeric"
          value={max}
          error={errors.max}
          onChange={(event) => setMax(event.target.value)}
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
