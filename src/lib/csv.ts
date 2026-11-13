// A small RFC 4180 CSV reader for the order importer (FR-RC-07): comma
// separated, fields optionally in double quotes ("" is a quote inside one),
// CRLF or LF line ends, an optional UTF-8 byte order mark. Blank lines are
// skipped. Each row keeps the line it starts on, for error messages.

export type CsvRow = { line: number; fields: string[] };

export class CsvSyntaxError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
    this.name = "CsvSyntaxError";
  }
}

export function parseCsv(text: string): CsvRow[] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false; // the current field was in quotes
  let line = 1;
  let rowLine = 1;
  let i = 0;

  const endField = () => {
    fields.push(field);
    field = "";
    quoted = false;
  };
  const endRow = () => {
    const blank = fields.length === 0 && field === "" && !quoted;
    endField();
    if (!blank) rows.push({ line: rowLine, fields });
    fields = [];
  };

  while (i < input.length) {
    const char = input[i]!;
    if (char === '"' && field === "" && !quoted) {
      // Quoted field: runs to the next lone quote.
      const opened = line;
      quoted = true;
      i++;
      for (;;) {
        if (i >= input.length) {
          throw new CsvSyntaxError(opened, "quoted field is not closed");
        }
        const inner = input[i]!;
        i++;
        if (inner === '"') {
          if (input[i] !== '"') break;
          i++;
        }
        if (inner === "\n") line++;
        field += inner;
      }
      const next = input[i];
      if (next !== undefined && !",\r\n".includes(next)) {
        throw new CsvSyntaxError(line, "text after a closing quote");
      }
    } else if (char === ",") {
      endField();
      i++;
    } else if (char === "\r" || char === "\n") {
      endRow();
      i += char === "\r" && input[i + 1] === "\n" ? 2 : 1;
      line++;
      rowLine = line;
    } else if (char === '"') {
      throw new CsvSyntaxError(line, "quote inside an unquoted field");
    } else {
      field += char;
      i++;
    }
  }
  if (fields.length > 0 || field !== "" || quoted) endRow();
  return rows;
}
