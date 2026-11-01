import { describe, expect, it } from "vitest";
import { initials } from "@/lib/initials";

describe("initials", () => {
  it.each([
    ["Dimas", "DI"],
    ["Dimas Anggara", "DA"],
    ["  sari  putri  ayu ", "SP"],
    ["A", "A"],
    ["", ""],
  ])("%j → %j", (name, letters) => {
    expect(initials(name)).toBe(letters);
  });
});
