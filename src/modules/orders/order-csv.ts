import { CsvSyntaxError, parseCsv } from "@/lib/csv";
import { parseRupiahInput } from "@/lib/money";
import { parseShopLocalTime } from "@/lib/time";
import { MAX_LINES, MAX_QUANTITY } from "./pricing";

// Order history from the old POS (FR-RC-07, docs/02 §10). Pure: the caller
// passes the menu, so the file can be checked without touching orders. One
// row per order line; rows with the same order_ref form one order.

export const REQUIRED_COLUMNS = [
  "order_ref",
  "paid_at",
  "item_name",
  "quantity",
] as const;
export const OPTIONAL_COLUMNS = ["unit_price"] as const;
export const MAX_ORDER_REF_LENGTH = 64;

type Column =
  (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];

// Every menu item, active or not: old orders may name retired items.
export type CatalogItem = { id: string; name: string; price: number };

export type ImportLine = {
  menuItemId: string;
  name: string; // the menu's spelling
  unitPrice: number;
  quantity: number;
};

export type ImportOrder = { ref: string; paidAt: Date; lines: ImportLine[] };

// `line` is the file's line number (the header is line 1).
export type CsvProblem = { line: number; message: string };

const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// ISO 8601 with an offset, or "YYYY-MM-DD HH:MM[:SS]" in shop time.
function parsePaidAt(text: string): Date | null {
  if (ISO_WITH_OFFSET.test(text)) {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return parseShopLocalTime(text);
}

const nameKey = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

export function readOrderCsv(
  text: string,
  catalog: readonly CatalogItem[],
  now: Date,
): { orders: ImportOrder[]; problems: CsvProblem[] } {
  let rows;
  try {
    rows = parseCsv(text);
  } catch (error) {
    if (!(error instanceof CsvSyntaxError)) throw error;
    return {
      orders: [],
      problems: [{ line: error.line, message: error.message }],
    };
  }
  const [header, ...dataRows] = rows;
  if (!header || dataRows.length === 0) {
    return {
      orders: [],
      problems: [{ line: 1, message: "the file has no order rows" }],
    };
  }

  const problems: CsvProblem[] = [];
  const names = header.fields.map((name) => name.trim().toLowerCase());
  const index = new Map<Column, number>();
  for (const column of [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]) {
    const at = names.indexOf(column);
    if (at === -1) continue;
    if (names.indexOf(column, at + 1) !== -1) {
      problems.push({
        line: header.line,
        message: `column "${column}" appears twice`,
      });
    }
    index.set(column, at);
  }
  for (const column of REQUIRED_COLUMNS) {
    if (!index.has(column)) {
      problems.push({
        line: header.line,
        message: `missing column "${column}"`,
      });
    }
  }
  if (problems.length > 0) return { orders: [], problems };

  const byName = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    const key = nameKey(item.name);
    byName.set(key, [...(byName.get(key) ?? []), item]);
  }

  const orders = new Map<string, ImportOrder & { line: number }>();
  for (const { line, fields } of dataRows) {
    if (fields.length !== header.fields.length) {
      problems.push({
        line,
        message: `expected ${header.fields.length} fields, found ${fields.length}`,
      });
      continue;
    }
    const get = (column: Column) => {
      const at = index.get(column);
      return at === undefined ? "" : fields[at]!.trim();
    };
    const fail = (message: string) => problems.push({ line, message });

    const ref = get("order_ref");
    if (ref === "") fail("order_ref is empty");
    else if (ref.length > MAX_ORDER_REF_LENGTH) {
      fail(`order_ref is longer than ${MAX_ORDER_REF_LENGTH} characters`);
    }

    const paidAtText = get("paid_at");
    const paidAt = parsePaidAt(paidAtText);
    if (!paidAt) {
      fail(
        `paid_at "${paidAtText}" is not "YYYY-MM-DD HH:MM" or an ISO time with an offset`,
      );
    } else if (paidAt > now) {
      fail(`paid_at "${paidAtText}" is in the future`);
    }

    const itemName = get("item_name");
    const matches = byName.get(nameKey(itemName)) ?? [];
    if (matches.length === 0) fail(`unknown menu item "${itemName}"`);
    else if (matches.length > 1) {
      fail(`"${itemName}" matches ${matches.length} menu items`);
    }

    const quantityText = get("quantity");
    const quantity = Number(quantityText);
    const quantityOk =
      /^\d+$/.test(quantityText) && quantity >= 1 && quantity <= MAX_QUANTITY;
    if (!quantityOk) {
      fail(`quantity must be a whole number from 1 to ${MAX_QUANTITY}`);
    }

    const priceText = get("unit_price");
    const unitPrice =
      priceText === "" ? matches[0]?.price : parseRupiahInput(priceText);
    if (unitPrice === null) {
      fail(`unit_price "${priceText}" is not a whole rupiah amount`);
    }

    const item = matches.length === 1 ? matches[0]! : undefined;
    if (!ref || ref.length > MAX_ORDER_REF_LENGTH || !paidAt || !item) continue;
    if (!quantityOk || unitPrice === null || unitPrice === undefined) continue;

    const order = orders.get(ref);
    if (!order) {
      orders.set(ref, {
        ref,
        paidAt,
        line,
        lines: [{ menuItemId: item.id, name: item.name, unitPrice, quantity }],
      });
      continue;
    }
    if (order.paidAt.getTime() !== paidAt.getTime()) {
      fail(`paid_at differs from line ${order.line} of order "${ref}"`);
      continue;
    }
    order.lines.push({
      menuItemId: item.id,
      name: item.name,
      unitPrice,
      quantity,
    });
  }

  for (const order of orders.values()) {
    if (order.lines.length > MAX_LINES) {
      problems.push({
        line: order.line,
        message: `order "${order.ref}" has more than ${MAX_LINES} lines`,
      });
    }
  }
  if (problems.length > 0) {
    problems.sort((a, b) => a.line - b.line);
    return { orders: [], problems };
  }
  return {
    orders: [...orders.values()]
      .map(({ ref, paidAt, lines }) => ({ ref, paidAt, lines }))
      .sort(
        (a, b) =>
          a.paidAt.getTime() - b.paidAt.getTime() || a.ref.localeCompare(b.ref),
      ),
    problems: [],
  };
}
