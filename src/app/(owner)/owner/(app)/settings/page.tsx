import { Suspense } from "react";
import { getEnv } from "@/lib/env";
import { ownerSettingKeys } from "@/modules/settings/schemas";
import { getAllSettings } from "@/modules/settings/service";
import { ownerSessionOrLogin } from "../../session";
import { type OwnerSettingsData, SettingsScreen } from "./settings-screen";

// O-14 basic (FR-OW-04, Figma 28:1967). The recommendation weights and
// thresholds come with P3-05.
export default function OwnerSettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  );
}

async function SettingsPage() {
  await ownerSessionOrLogin();
  const all = await getAllSettings();
  const settings = Object.fromEntries(
    ownerSettingKeys.map((key) => [key, all[key]]),
  ) as OwnerSettingsData;
  return (
    <SettingsScreen
      initial={settings}
      mockPayments={getEnv().PAYMENT_PROVIDER === "mock"}
    />
  );
}
