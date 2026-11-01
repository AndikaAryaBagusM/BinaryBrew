import { cn } from "@/lib/cn";

// Figma "Brand/Wordmark" (4:19): placeholder until the Binary Brew logo
// exists (DQ1); the "01" tile is the binary bean mark. The dark theme is for
// the TV board.
export function BrandWordmark({
  size = "s",
  theme = "light",
}: {
  size?: "s" | "l";
  theme?: "light" | "dark";
}) {
  const large = size === "l";
  const dark = theme === "dark";
  return (
    <div className={cn("flex items-center", large ? "gap-3" : "gap-2.5")}>
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center font-mono font-medium",
          dark ? "bg-accent text-brand-dark" : "bg-brand text-accent",
          large
            ? "size-10 rounded-[10px] text-[17px]"
            : "size-7.5 rounded-control text-caption",
        )}
      >
        01
      </span>
      <span
        className={cn(
          "font-bold",
          dark ? "text-board-text" : "text-brand",
          large ? "text-h1" : "text-h2",
        )}
      >
        Binary Brew
      </span>
    </div>
  );
}
