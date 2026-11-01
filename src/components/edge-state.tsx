import { CircleAlert, QrCode, Store, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@/i18n";

// C-08 edge states (Design §7): one layout with an icon, a title, one
// sentence and an optional action. Later tasks add the checkout variants.
export type EdgeStateVariant = "qrInvalid" | "closed" | "error";

const variants: Record<
  EdgeStateVariant,
  { icon: LucideIcon; title: MessageKey; text?: MessageKey }
> = {
  qrInvalid: {
    icon: QrCode,
    title: "edge.qrInvalid.title",
    text: "edge.qrInvalid.text",
  },
  closed: { icon: Store, title: "edge.closed.title", text: "edge.closed.text" },
  error: { icon: CircleAlert, title: "error.generic" },
};

export type EdgeStateProps = {
  variant: EdgeStateVariant;
  action?: ReactNode;
};

export function EdgeState({ variant, action }: EdgeStateProps) {
  const { icon: Icon, title, text } = variants[variant];
  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-price">
        <Icon aria-hidden="true" size={32} />
      </div>
      <h1 className="text-h1 text-ink">{t(title)}</h1>
      {text && <p className="text-body text-ink-muted">{t(text)}</p>}
      {action && <div className="mt-3">{action}</div>}
    </main>
  );
}
