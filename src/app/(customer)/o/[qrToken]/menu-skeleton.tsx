import { t } from "@/i18n";

// Loading skeleton for C-01 (Design §5): header, tabs and three cards.
const block = "bg-surface-sunken motion-safe:animate-pulse";

export function MenuSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-4 px-4 pt-3"
    >
      <span className="sr-only">{t("common.loading")}</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className={`h-7 w-40 rounded-control ${block}`} />
        <div className={`h-4 w-20 rounded-control ${block}`} />
      </div>
      <div aria-hidden="true" className="flex gap-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className={`h-8 w-20 rounded-control ${block}`} />
        ))}
      </div>
      {[0, 1, 2].map((key) => (
        <div
          key={key}
          aria-hidden="true"
          className={`h-[90px] rounded-card ${block}`}
        />
      ))}
    </div>
  );
}
