import { cn } from "@/lib/cn";

// Figma "Brand/Wordmark" (4:19): placeholder until the Binary Brew logo
// exists (DQ1); the "01" tile is the binary bean mark.
export function BrandWordmark({ size = "s" }: { size?: "s" | "l" }) {
  const large = size === "l";
  return (
    <div className={cn("flex items-center", large ? "gap-3" : "gap-2.5")}>
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center bg-brand font-mono font-medium text-accent",
          large
            ? "size-10 rounded-[10px] text-[17px]"
            : "size-7.5 rounded-control text-caption",
        )}
      >
        01
      </span>
      <span
        className={cn("font-bold text-brand", large ? "text-h1" : "text-h2")}
      >
        Binary Brew
      </span>
    </div>
  );
}
