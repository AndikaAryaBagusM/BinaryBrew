"use client";

import {
  Check,
  type LucideIcon,
  Percent,
  ReceiptText,
  Sparkles,
  Store,
  WalletCards,
} from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";
import { formatBpsAsPercent, percentToBps } from "@/lib/money";
import type { Settings } from "@/modules/settings/definitions";
import type { OwnerSettingKey } from "@/modules/settings/schemas";
import {
  Notice,
  PageBody,
  PageHead,
  SwitchRow,
  Tag,
  useSignedOutGuard,
} from "../owner-ui";

export type OwnerSettingsData = Pick<Settings, OwnerSettingKey>;

// The text fields as typed; the rest are already values.
type Draft = Omit<
  OwnerSettingsData,
  "tax_rate_bps" | "service_charge_bps" | "low_margin_threshold_pct"
> & { taxRate: string; serviceCharge: string; lowMargin: string };

function toDraft(settings: OwnerSettingsData): Draft {
  const {
    tax_rate_bps,
    service_charge_bps,
    low_margin_threshold_pct,
    ...rest
  } = settings;
  return {
    ...rest,
    taxRate: formatBpsAsPercent(tax_rate_bps),
    serviceCharge: formatBpsAsPercent(service_charge_bps),
    lowMargin: String(low_margin_threshold_pct).replace(".", ","),
  };
}

// "30", "12,5" → 30, 12.5; null outside 0–100.
function parsePercent(text: string): number | null {
  const bps = percentToBps(text);
  return bps === null ? null : bps / 100;
}

const hours = Array.from({ length: 7 }, (_, hour) => `0${hour}:00`);
const expiryMinutes = [5, 10, 15, 20, 30];
const autoCompleteMinutes = [15, 30, 45, 60, 90, 120];
const retentionMonths = [6, 12, 24, 36, 60];

// Choices for a select; the saved value stays listed even when it is not one
// of the usual ones.
function choices(
  values: readonly number[],
  current: number,
  label: (value: number) => string,
) {
  const all = values.includes(current)
    ? values
    : [...values, current].sort((a, b) => a - b);
  return all.map((value) => ({ value: String(value), label: label(value) }));
}

const clock = (value: string) => value.replace(":", ".");

// O-14 basic: one form, one "Simpan perubahan". Only changed keys are sent;
// the server checks all of them, saves them in one transaction and audits
// each change (FR-OW-04).
export function SettingsScreen({
  initial,
  mockPayments,
}: {
  initial: OwnerSettingsData;
  mockPayments: boolean;
}) {
  const formId = useId();
  const signedOut = useSignedOutGuard();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setNotice(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  // The draft as settings, or the fields that do not parse.
  function read():
    | { ok: true; values: OwnerSettingsData }
    | { ok: false; errors: typeof errors } {
    const { taxRate, serviceCharge, lowMargin, ...rest } = draft;
    const tax = percentToBps(taxRate);
    const service = percentToBps(serviceCharge);
    const margin = parsePercent(lowMargin);
    const shopName = rest.shop_name.trim();
    const problems: typeof errors = {};
    if (!shopName) problems.shop_name = t("owner.nameRequired");
    if (tax === null) problems.taxRate = t("owner.percentInvalid");
    if (service === null) problems.serviceCharge = t("owner.percentInvalid");
    if (margin === null) problems.lowMargin = t("owner.percentInvalid");
    if (tax === null || service === null || margin === null || !shopName) {
      return { ok: false, errors: problems };
    }
    return {
      ok: true,
      values: {
        ...rest,
        shop_name: shopName,
        tax_rate_bps: tax,
        service_charge_bps: service,
        low_margin_threshold_pct: margin,
      },
    };
  }

  const parsed = read();
  const changes = parsed.ok
    ? (Object.keys(parsed.values) as OwnerSettingKey[]).filter(
        (key) => parsed.values[key] !== saved[key],
      )
    : [];
  const dirty = !parsed.ok || changes.length > 0;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    if (changes.length === 0) return;
    setBusy(true);
    setNotice(null);
    const body = Object.fromEntries(
      changes.map((key) => [key, parsed.values[key]]),
    );
    const result = await api("/api/owner/settings", { method: "PUT", body });
    if (signedOut(result)) return;
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "danger", text: result.error.message });
      return;
    }
    setSaved(parsed.values);
    setDraft(toDraft(parsed.values));
    setNotice({ tone: "success", text: t("owner.settingsSaved") });
  }

  return (
    <PageBody>
      <PageHead
        title={t("owner.settingsTitle")}
        subtitle={t("owner.settingsSubtitle")}
      >
        <Button
          type="submit"
          form={formId}
          loading={busy}
          disabled={!dirty}
          icon={<Check aria-hidden="true" />}
        >
          {t("owner.saveChanges")}
        </Button>
      </PageHead>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <form
        id={formId}
        noValidate
        onSubmit={(event) => void save(event)}
        className="grid items-start gap-5 lg:grid-cols-2"
      >
        <div className="flex flex-col gap-5">
          <Card icon={Store} title={t("owner.settingsShop")}>
            <TextField
              label={t("owner.shopName")}
              value={draft.shop_name}
              maxLength={60}
              error={errors.shop_name}
              onChange={(event) => set("shop_name", event.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t("owner.timezone")}
                value="Asia/Jakarta"
                disabled
                options={[
                  { value: "Asia/Jakarta", label: t("owner.timezoneWib") },
                ]}
              />
              <SelectField
                label={t("owner.cutoff")}
                value={draft.business_day_cutoff}
                helper={t("owner.cutoffHelp", {
                  time: clock(draft.business_day_cutoff),
                })}
                options={(hours.includes(draft.business_day_cutoff)
                  ? hours
                  : [...hours, draft.business_day_cutoff].sort()
                ).map((value) => ({ value, label: clock(value) }))}
                onChange={(event) =>
                  set("business_day_cutoff", event.target.value)
                }
              />
            </div>
            <SwitchRow
              label={t("owner.orderingEnabled")}
              help={t("owner.orderingEnabledHelp")}
              checked={draft.ordering_enabled}
              onChange={(value) => set("ordering_enabled", value)}
            />
          </Card>

          <Card icon={Percent} title={t("owner.settingsTax")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t("owner.taxRate")}
                inputMode="decimal"
                suffix="%"
                value={draft.taxRate}
                error={errors.taxRate}
                helper={t("owner.taxRateHelp")}
                onChange={(event) => set("taxRate", event.target.value)}
              />
              <TextField
                label={t("owner.serviceCharge")}
                inputMode="decimal"
                suffix="%"
                value={draft.serviceCharge}
                error={errors.serviceCharge}
                helper={t("owner.serviceChargeHelp")}
                onChange={(event) => set("serviceCharge", event.target.value)}
              />
            </div>
            <SwitchRow
              label={t("owner.taxInclusive")}
              help={
                draft.tax_inclusive
                  ? t("owner.taxInclusiveOn")
                  : t("owner.taxInclusiveOff")
              }
              checked={draft.tax_inclusive}
              onChange={(value) => set("tax_inclusive", value)}
            />
          </Card>

          <Card icon={Sparkles} title={t("owner.settingsReco")}>
            <TextField
              label={t("owner.lowMargin")}
              inputMode="decimal"
              suffix="%"
              value={draft.lowMargin}
              error={errors.lowMargin}
              helper={t("owner.lowMarginHelp")}
              onChange={(event) => set("lowMargin", event.target.value)}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card icon={WalletCards} title={t("owner.settingsPayment")}>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-owner-body font-semibold text-ink">
                  {t("owner.qrisDynamic")}
                </p>
                <p className="text-caption text-ink-muted">
                  {mockPayments
                    ? t("owner.qrisGatewayMock")
                    : t("owner.qrisGateway")}
                </p>
              </div>
              <Tag tone="ready">{t("owner.active")}</Tag>
            </div>
            <SelectField
              label={t("owner.paymentExpiry")}
              value={String(draft.order_expiry_minutes)}
              helper={t("owner.paymentExpiryHelp")}
              options={choices(expiryMinutes, draft.order_expiry_minutes, (n) =>
                t("owner.minutes", { n }),
              )}
              onChange={(event) =>
                set("order_expiry_minutes", Number(event.target.value))
              }
            />
            <SwitchRow
              label={t("owner.cash")}
              help={t("owner.cashHelp")}
              checked={false}
              disabled
            />
            <SwitchRow
              label={t("owner.manualPin")}
              help={t("owner.manualPinHelp")}
              checked={draft.manual_payment_requires_owner_pin}
              onChange={(value) =>
                set("manual_payment_requires_owner_pin", value)
              }
            />
          </Card>

          <Card icon={ReceiptText} title={t("owner.settingsOrders")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t("owner.autoComplete")}
                value={String(draft.ready_auto_complete_minutes)}
                helper={t("owner.autoCompleteHelp")}
                options={choices(
                  autoCompleteMinutes,
                  draft.ready_auto_complete_minutes,
                  (n) => t("owner.minutes", { n }),
                )}
                onChange={(event) =>
                  set("ready_auto_complete_minutes", Number(event.target.value))
                }
              />
              <SelectField
                label={t("owner.retention")}
                value={String(draft.order_retention_months)}
                helper={t("owner.retentionHelp")}
                options={choices(
                  retentionMonths,
                  draft.order_retention_months,
                  (n) => t("owner.months", { n }),
                )}
                onChange={(event) =>
                  set("order_retention_months", Number(event.target.value))
                }
              />
            </div>
          </Card>
        </div>
      </form>
    </PageBody>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-key border border-line bg-surface p-6">
      <h2 className="flex items-center gap-2.5 text-h2 text-ink">
        <Icon aria-hidden="true" size={24} />
        {title}
      </h2>
      {children}
    </section>
  );
}
