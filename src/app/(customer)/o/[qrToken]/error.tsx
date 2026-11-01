"use client";

import { Button } from "@/components/button";
import { EdgeState } from "@/components/edge-state";
import { t } from "@/i18n";

// C-08 server error: the menu could not be loaded (e.g. database down).
export default function MenuError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <EdgeState
      variant="error"
      action={<Button onClick={() => retry()}>{t("common.retry")}</Button>}
    />
  );
}
