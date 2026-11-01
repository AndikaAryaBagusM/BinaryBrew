import { qrMatrixPath } from "@/lib/qr";

// C-05 QR (Design §7): drawn on the server as one SVG path. Dark modules use
// `ink` on a `surface` square with the quiet zone, the contrast scanners need.
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = qrMatrixPath(value);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="aspect-square w-full max-w-72 rounded-card bg-surface text-ink"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
