import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { PinPad } from "@/components/pin-pad";
import { StatusChip, type OrderChipStatus } from "@/components/status-chip";
import { Switch } from "@/components/switch";

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("Button", () => {
  it("is a real button that does not submit forms by default", () => {
    expect(html(<Button>Bayar</Button>)).toMatch(/^<button type="button"/);
  });

  it("meets the target sizes: customer 48 px, counter 60 px (Design §5)", () => {
    expect(html(<Button size="customer">Bayar</Button>)).toContain("h-12");
    expect(html(<Button size="counter">Bayar</Button>)).toContain("h-15");
  });

  it("keeps the label while loading, is busy and cannot be pressed", () => {
    const markup = html(<Button loading>Bayar dengan QRIS</Button>);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/<button[^>]* disabled=""/);
    expect(markup).toContain("Bayar dengan QRIS");
    expect(markup).toContain("Memuat…");
    expect(markup).toContain("/icons/spinner-on-brand-20.svg");
  });

  it("uses the brand-coloured spinner on light buttons", () => {
    expect(
      html(
        <Button variant="secondary" size="counter" loading>
          Batalkan
        </Button>,
      ),
    ).toContain("/icons/spinner-brand-24.svg");
  });

  it.each(["primary", "secondary", "destructive", "ghost"] as const)(
    "renders the %s variant with a visible focus ring",
    (variant) => {
      expect(html(<Button variant={variant}>OK</Button>)).toContain(
        "focus-ring",
      );
    },
  );
});

describe("StatusChip", () => {
  const cases: [OrderChipStatus, string][] = [
    ["awaiting_payment", "Menunggu bayar"],
    ["paid", "Baru"],
    ["preparing", "Disiapkan"],
    ["ready", "Siap diambil"],
    ["completed", "Selesai"],
    ["expired", "Kedaluwarsa"],
    ["voided", "Dibatalkan"],
  ];

  it.each(cases)("%s shows an icon and the text %s", (status, label) => {
    const markup = html(<StatusChip status={status} />);
    expect(markup).toContain(label);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

describe("PinPad", () => {
  const markup = html(<PinPad onComplete={() => {}} />);

  it("is a labelled group with ten digit keys and a delete key", () => {
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Papan PIN"');
    for (const digit of "0123456789") {
      expect(markup).toContain(`aria-label="${digit}"`);
    }
    expect(markup).toContain('aria-label="Hapus"');
  });

  it("uses 80 × 72 px keys (Figma PIN key)", () => {
    expect(markup).toContain("h-18 w-20");
  });

  it("shows a dot for each of the first 4 digits and announces progress", () => {
    // PINs are 4–6 digits (PRD A4); the pad never shows a user's PIN length.
    expect(markup.match(/data-dot="empty"/g)).toHaveLength(4);
    expect(markup).toContain("0 digit dimasukkan");
  });

  it("has a Masuk key in the bottom-left slot, off until 4 digits", () => {
    expect(markup).toMatch(/<button[^>]* disabled=""[^>]*>Masuk<\/button>/);
    const keys = [...markup.matchAll(/aria-label="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((label) => label !== "Papan PIN");
    expect(keys).toEqual([..."123456789", "Masuk", "0", "Hapus"]);
  });

  it("disables every key while locked", () => {
    const locked = html(<PinPad disabled onComplete={() => {}} />);
    expect(locked.match(/<button[^>]* disabled=""/g)).toHaveLength(12);
  });
});

describe("Switch", () => {
  it("is a button with the switch role and its state", () => {
    const on = html(<Switch checked aria-label="Promosikan Latte" />);
    expect(on).toMatch(
      /^<button type="button" role="switch" aria-checked="true"/,
    );
    expect(on).toContain('aria-label="Promosikan Latte"');
    expect(on).toContain("bg-brand");
    expect(html(<Switch checked={false} aria-label="x" />)).toContain(
      'aria-checked="false"',
    );
  });
});

describe("Field", () => {
  it("labels the input and ties the helper to it", () => {
    const markup = html(
      <TextField id="price" label="Harga" helper="Dalam rupiah" prefix="Rp" />,
    );
    expect(markup).toContain('<label for="price"');
    expect(markup).toContain('aria-describedby="price-help"');
    expect(markup).not.toContain("aria-invalid");
  });

  it("marks an error and reads it before the helper", () => {
    const markup = html(
      <TextField id="pin" label="PIN" helper="4–6 angka" error="PIN salah" />,
    );
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="pin-error pin-help"');
    expect(markup).toContain("PIN salah");
    expect(markup).toContain("border-danger");
  });

  it("renders a labelled select with its options", () => {
    const markup = html(
      <SelectField
        id="expiry"
        label="Batas waktu"
        value="10"
        onChange={() => {}}
        options={[
          { value: "5", label: "5 menit" },
          { value: "10", label: "10 menit" },
        ]}
      />,
    );
    expect(markup).toContain('<label for="expiry"');
    expect(markup).toContain(
      '<option value="10" selected="">10 menit</option>',
    );
  });
});
