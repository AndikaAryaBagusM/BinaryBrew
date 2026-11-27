import { t } from "@/i18n";

// S-06 void reasons (P3-01); labels are counter.voidReason* in i18n/id.json.
export const voidReasons = [
  "changed_mind",
  "wrong_order",
  "cannot_make",
  "double_payment",
  "other",
] as const;
export type VoidReason = (typeof voidReasons)[number];

export const voidReasonLabel = {
  changed_mind: "counter.voidReasonChangedMind",
  wrong_order: "counter.voidReasonWrongOrder",
  cannot_make: "counter.voidReasonCannotMake",
  double_payment: "counter.voidReasonDoublePayment",
  other: "counter.voidReasonOther",
} as const satisfies Record<VoidReason, string>;

// The text kept on the order and the refund: the chosen reason, then the
// note ("Lainnya" is only the note, which it requires). Empty when "Lainnya"
// has no note.
export function voidReasonText(reason: VoidReason, note?: string): string {
  const extra = note?.trim();
  if (reason === "other") return extra ?? "";
  const label = t(voidReasonLabel[reason]);
  return extra ? `${label} · ${extra}` : label;
}
