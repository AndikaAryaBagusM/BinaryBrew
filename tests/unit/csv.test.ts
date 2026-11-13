import { describe, expect, it } from "vitest";
import { CsvSyntaxError, parseCsv } from "@/lib/csv";

const fields = (text: string) => parseCsv(text).map((row) => row.fields);

describe("parseCsv (RFC 4180)", () => {
  it("splits rows and fields", () => {
    expect(fields("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("accepts CRLF, a byte order mark and a missing final line end", () => {
    expect(fields("﻿a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields, quoted or not", () => {
    expect(fields('a,,""\n,x,')).toEqual([
      ["a", "", ""],
      ["", "x", ""],
    ]);
  });

  it("reads quoted commas, quotes and line breaks", () => {
    expect(fields('"Rp 18.000, promo","say ""hi""","two\r\nlines"')).toEqual([
      ["Rp 18.000, promo", 'say "hi"', "two\r\nlines"],
    ]);
  });

  it("skips blank lines and reports the line each row starts on", () => {
    expect(parseCsv('h\n\n"a\nb"\nc\n')).toEqual([
      { line: 1, fields: ["h"] },
      { line: 3, fields: ["a\nb"] },
      { line: 5, fields: ["c"] },
    ]);
  });

  it.each([
    ['a\n"open', 2, "quoted field is not closed"],
    ['"a"b', 1, "text after a closing quote"],
    ['a\nb"c', 2, "quote inside an unquoted field"],
  ])("refuses %j", (text, line, message) => {
    expect(() => parseCsv(text)).toThrow(
      expect.objectContaining({ line, message: `line ${line}: ${message}` }),
    );
    expect(() => parseCsv(text)).toThrow(CsvSyntaxError);
  });
});
