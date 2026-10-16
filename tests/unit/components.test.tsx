import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/button";
import { PinPad } from "@/components/pin-pad";
import { StatusChip, type OrderChipStatus } from "@/components/status-chip";

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

  it("shows one dot per digit and announces progress", () => {
    expect(markup.match(/data-dot=/g)).toHaveLength(4);
    expect(markup).toContain("0 dari 4 digit");
    expect(html(<PinPad length={6} onComplete={() => {}} />)).toContain(
      "0 dari 6 digit",
    );
  });

  it("disables every key while locked", () => {
    const locked = html(<PinPad disabled onComplete={() => {}} />);
    expect(locked.match(/<button[^>]* disabled=""/g)).toHaveLength(11);
  });
});
