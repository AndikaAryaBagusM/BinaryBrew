import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "@/i18n";
import messages from "@/i18n/id.json";

// Rows of the docs/04 §9 table: | `key` | Text |
function docMessages(): [key: string, text: string][] {
  const doc = readFileSync("docs/04-design-brief.md", "utf8");
  const section = doc.slice(
    doc.indexOf("## 9. Content and microcopy"),
    doc.indexOf("## 10."),
  );
  return [...section.matchAll(/^\| `([\w.]+)` \| (.+?) \|$/gm)].map((match) => [
    match[1]!,
    match[2]!.trim(),
  ]);
}

describe("id.json matches docs/04 §9", () => {
  const rows = docMessages();

  it("finds the table in the design brief", () => {
    expect(rows.length).toBeGreaterThanOrEqual(35);
  });

  it.each(rows)("%s = %s", (key, text) => {
    expect(messages).toHaveProperty([key], text);
  });
});

describe("t()", () => {
  it("returns plain messages", () => {
    expect(t("cart.payQris")).toBe("Bayar dengan QRIS");
  });

  it("fills placeholders", () => {
    expect(t("pay.countdown", { time: "09:41" })).toBe("Bayar dalam 09:41");
    expect(t("counter.pinWrong", { n: 3 })).toBe(
      "PIN salah. Sisa percobaan: 3",
    );
    expect(t("pin.progress", { entered: 2, total: 4 })).toBe("2 dari 4 digit");
  });

  it("throws when a placeholder has no value", () => {
    expect(() => t("pay.countdown")).toThrow('Missing parameter "time"');
  });

  it("has no empty messages", () => {
    for (const [key, text] of Object.entries(messages)) {
      expect(text.trim(), key).not.toBe("");
    }
  });
});
