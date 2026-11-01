import { t } from "@/i18n";

const block = "bg-surface-sunken motion-safe:animate-pulse";

export function StatusSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-120 flex-1 flex-col items-center gap-4 px-4 pt-8"
    >
      <span className="sr-only">{t("common.loading")}</span>
      <div aria-hidden="true" className={`h-6 w-40 rounded-control ${block}`} />
      <div
        aria-hidden="true"
        className={`aspect-square w-full max-w-72 rounded-card ${block}`}
      />
      <div
        aria-hidden="true"
        className={`h-10 w-32 rounded-control ${block}`}
      />
    </div>
  );
}
