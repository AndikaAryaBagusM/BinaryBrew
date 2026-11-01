import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EdgeState } from "@/components/edge-state";
import { MenuItemCard } from "@/components/menu-item-card";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const item = {
  id: "8d5b7c1e-0000-4000-8000-000000000001",
  name: "Kopi Susu Gula Aren",
  description: "Espresso, susu segar dan gula aren.",
  price: 22000,
  imageUrl: null,
  isAvailable: true,
  modifierGroups: [],
};

describe("MenuItemCard (C-01)", () => {
  it("shows name, description and the price in rupiah", () => {
    const markup = html(<MenuItemCard item={item} />);
    expect(markup).toContain("Kopi Susu Gula Aren");
    expect(markup).toContain("Espresso, susu segar dan gula aren.");
    expect(markup).toContain("Rp 22.000");
  });

  it("has an add button named after the item", () => {
    const markup = html(<MenuItemCard item={item} />);
    expect(markup).toMatch(
      /<button[^>]*aria-label="Tambah Kopi Susu Gula Aren"/,
    );
    expect(markup).not.toContain("Habis");
  });

  it("shows sold-out items as Habis with a disabled button", () => {
    const markup = html(
      <MenuItemCard item={{ ...item, isAvailable: false }} />,
    );
    expect(markup).toContain("Habis");
    expect(markup).toMatch(/<button[^>]* disabled=""/);
  });
});

describe("EdgeState (C-08)", () => {
  it("explains an invalid QR code without offering a dead end button", () => {
    const markup = html(<EdgeState variant="qrInvalid" />);
    expect(markup).toContain("Kode QR sudah tidak berlaku");
    expect(markup).toContain("Silakan scan kode di kasir");
    expect(markup).toMatch(/<h1[^>]*>Kode QR sudah tidak berlaku<\/h1>/);
  });

  it("explains that ordering is closed and the counter still works", () => {
    const markup = html(<EdgeState variant="closed" />);
    expect(markup).toContain("Pemesanan sedang ditutup");
    expect(markup).toContain("kasir");
  });

  it("offers a retry button for server errors", () => {
    const markup = html(
      <EdgeState variant="error" action={<button>Coba lagi</button>} />,
    );
    expect(markup).toContain("Ada gangguan, coba lagi");
    expect(markup).toContain("Coba lagi</button>");
  });
});
