import { t } from "@/i18n";
import { formatQuantityDelta, toMilli } from "@/lib/quantity";

// O-04 / O-06 texts for a group's limits and an option's stock effect.

// "Wajib · pilih 1", "Wajib · pilih 1–2", "Opsional · maks 2".
export function groupRuleText(group: {
  minSelect: number;
  maxSelect: number;
}): string {
  if (group.minSelect === 0) {
    return t("owner.groupOptional", { n: group.maxSelect });
  }
  return group.minSelect === group.maxSelect
    ? t("owner.groupRequired", { n: group.minSelect })
    : t("owner.groupRequiredRange", {
        min: group.minSelect,
        max: group.maxSelect,
      });
}

// "+9 g Biji kopi arabika · −150 ml Susu UHT" (Figma O-04).
export function deltaText(
  deltas: readonly { ingredientId: string; qtyDelta: string }[],
  ingredients: ReadonlyMap<string, { name: string; unit: string }>,
): string {
  return deltas
    .map((delta) => {
      const ingredient = ingredients.get(delta.ingredientId);
      const qty = formatQuantityDelta(toMilli(delta.qtyDelta));
      return ingredient ? `${qty} ${ingredient.unit} ${ingredient.name}` : qty;
    })
    .join(" · ");
}
