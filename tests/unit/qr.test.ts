import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { qrMatrixPath } from "@/lib/qr";

// C-05 draws the QRIS string as an SVG path (one unit per module) so the page
// colours it with tokens instead of fixed colours.

describe("qrMatrixPath", () => {
  const value = "MOCKQRIS|mock_abc|88000|2026-11-01T12:10:00.000Z";

  it("covers exactly the dark modules, inside a quiet zone", () => {
    const { size, path } = qrMatrixPath(value);
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const modules = qr.modules.size;
    // 4-module quiet zone on each side (ISO/IEC 18004).
    expect(size).toBe(modules + 8);

    const dark = qr.modules.data.filter(Boolean).length;
    const squares = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(squares).toHaveLength(dark);
    expect(squares.join("")).toBe(path);
    // Top-left finder pattern starts at the quiet-zone corner.
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });

  it("is deterministic", () => {
    expect(qrMatrixPath(value)).toEqual(qrMatrixPath(value));
    expect(qrMatrixPath(value).path).not.toBe(qrMatrixPath(value + "x").path);
  });
});
