import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModifierGroup } from "@/components/modifier-group";
import { QuantityStepper } from "@/components/quantity-stepper";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

const size = {
  id: "g-size",
  name: "Ukuran",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: "o-regular", name: "Regular", priceDelta: 0, isDefault: true },
    { id: "o-large", name: "Large", priceDelta: 5_000, isDefault: false },
  ],
};
const extras = {
  id: "g-extras",
  name: "Tambahan",
  minSelect: 0,
  maxSelect: 2,
  options: [
    { id: "o-shot", name: "Extra shot", priceDelta: 5_000, isDefault: false },
    { id: "o-oat", name: "Susu oat", priceDelta: 6_000, isDefault: false },
    { id: "o-less", name: "Kurang es", priceDelta: -1_000, isDefault: false },
  ],
};

describe("ModifierGroup (Design §5)", () => {
  it("is a labelled radio list for a pick-one group, marked Wajib pilih", () => {
    const markup = html(
      <ModifierGroup group={size} selected={["o-regular"]} onChange={noop} />,
    );
    expect(markup).toMatch(
      /<fieldset[^>]*>[\s\S]*<legend[^>]*>[\s\S]*Ukuran[\s\S]*<\/legend>/,
    );
    expect(markup).toContain("Wajib pilih");
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup).toMatch(
      /<input[^>]*type="radio"[^>]*checked=""[^>]*value="o-regular"|<input[^>]*value="o-regular"[^>]*checked=""/,
    );
  });

  it("shows price deltas on the right, nothing for free options", () => {
    const markup = html(
      <ModifierGroup group={extras} selected={[]} onChange={noop} />,
    );
    expect(markup).toContain("+Rp 5.000");
    expect(markup).toContain("−Rp 1.000");
    expect(markup).not.toContain("Rp 0");
  });

  it("is a checkbox list with its limit for a pick-many group", () => {
    const markup = html(
      <ModifierGroup group={extras} selected={[]} onChange={noop} />,
    );
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
    expect(markup).toContain("Pilih maks. 2");
    expect(markup).not.toContain("Wajib pilih");
  });

  it("disables the remaining checkboxes once the limit is reached", () => {
    const markup = html(
      <ModifierGroup
        group={extras}
        selected={["o-shot", "o-oat"]}
        onChange={noop}
      />,
    );
    const inputs = markup.match(/<input[^>]*>/g)!;
    const less = inputs.find((input) => input.includes('value="o-less"'))!;
    const shot = inputs.find((input) => input.includes('value="o-shot"'))!;
    expect(less).toContain('disabled=""');
    expect(shot).not.toContain('disabled=""');
  });

  it("marks the group invalid when Add was tapped without a choice", () => {
    const empty = {
      ...size,
      options: size.options.map((o) => ({ ...o, isDefault: false })),
    };
    const markup = html(
      <ModifierGroup group={empty} selected={[]} onChange={noop} invalid />,
    );
    expect(markup).toContain('aria-invalid="true"');
  });
});

describe("QuantityStepper (Design §5)", () => {
  it("names its buttons and shows the count", () => {
    const markup = html(<QuantityStepper value={3} onChange={noop} />);
    expect(markup).toMatch(/<button[^>]*aria-label="Kurangi jumlah"/);
    expect(markup).toMatch(/<button[^>]*aria-label="Tambah jumlah"/);
    expect(markup).toContain(">3<");
  });

  it("disables minus at 1 and plus at 20", () => {
    const low = html(<QuantityStepper value={1} onChange={noop} />);
    expect(low).toMatch(
      /<button[^>]*aria-label="Kurangi jumlah"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Kurangi jumlah"/,
    );
    const high = html(<QuantityStepper value={20} onChange={noop} />);
    expect(high).toMatch(
      /<button[^>]*aria-label="Tambah jumlah"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Tambah jumlah"/,
    );
  });
});

describe("Counter variants (S-02, S-03)", () => {
  it("shows option cards with the optional limit", () => {
    const markup = html(
      <ModifierGroup
        size="counter"
        group={extras}
        selected={["o-shot"]}
        onChange={noop}
      />,
    );
    expect(markup).toContain("Opsional · maks 2");
    expect(markup).not.toContain("Pilih maks. 2");
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
  });

  it("lets a cart line go to zero with a named remove button", () => {
    const markup = html(
      <QuantityStepper
        size="counter"
        min={0}
        value={1}
        onChange={noop}
        decreaseLabel="Hapus Croissant"
      />,
    );
    expect(markup).toMatch(/<button[^>]*aria-label="Hapus Croissant"/);
    expect(markup).not.toMatch(
      /<button[^>]*aria-label="Hapus Croissant"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Hapus Croissant"/,
    );
  });
});
