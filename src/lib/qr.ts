import QRCode from "qrcode";

// The QRIS string as an SVG path, one unit per module, so C-05 can colour it
// with tokens (Design §4.2) instead of the library's fixed colours. Server
// only: the library never reaches the phone.

const QUIET_ZONE = 4; // modules of blank border, as scanners expect

export function qrMatrixPath(value: string): { size: number; path: string } {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  let path = "";
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) {
        path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
  }
  return { size: modules.size + QUIET_ZONE * 2, path };
}
