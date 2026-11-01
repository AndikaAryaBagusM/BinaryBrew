"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/button";
import { t } from "@/i18n";

export function PrintButton() {
  return (
    <Button
      variant="secondary"
      icon={<Printer aria-hidden="true" />}
      onClick={() => window.print()}
    >
      {t("receipt.print")}
    </Button>
  );
}
