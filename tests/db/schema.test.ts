import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The migrated test database (freshly reset by global-setup.ts).
const testUrl = process.env.TEST_DATABASE_URL!;
// A throwaway database built straight from the DDL in docs/05 §3.
const refUrl = Object.assign(new URL(testUrl), {
  pathname: "/binarybrew_ref",
}).toString();

const quiet = { max: 1, onnotice: () => {} };
const migrated = postgres(testUrl, quiet);
let reference: postgres.Sql;

function docDdl(): string {
  const doc = readFileSync("docs/05-backend-schema.md", "utf8");
  const section = doc.slice(doc.indexOf("## 3. DDL"));
  const match = /```sql\n([\s\S]*?)```/.exec(section);
  if (!match?.[1]) throw new Error("No SQL block found in docs/05 §3");
  return match[1];
}

beforeAll(async () => {
  await migrated`drop database if exists binarybrew_ref with (force)`;
  await migrated`create database binarybrew_ref`;
  reference = postgres(refUrl, quiet);
  await reference.unsafe(docDdl());
});

afterAll(async () => {
  await reference?.end();
  await migrated`drop database if exists binarybrew_ref with (force)`;
  await migrated.end();
});

// Everything in the public schema that the DDL defines. The drizzle schema
// (migration journal) is deliberately left out.
const catalogQueries = {
  enums: `
    select t.typname as name,
           array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typnamespace = 'public'::regnamespace
    group by t.typname order by 1`,
  columns: `
    select table_name, column_name, data_type, udt_name,
           numeric_precision, numeric_scale, is_nullable, column_default,
           is_identity, identity_generation, is_generated, generation_expression
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, column_name`,
  constraints: `
    select conrelid::regclass::text as table_name, conname as name,
           contype as type, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where connamespace = 'public'::regnamespace and contype in ('p', 'u', 'f', 'c')
    order by 1, 2`,
  indexes: `
    select tablename, indexname, indexdef
    from pg_indexes where schemaname = 'public'
    order by 1, 2`,
  functions: `
    select proname as name,
           pg_get_function_identity_arguments(oid) as arguments,
           pg_get_functiondef(oid) as definition
    from pg_proc where pronamespace = 'public'::regnamespace
    order by 1, 2`,
  triggers: `
    select tgname as name, tgrelid::regclass::text as table_name,
           pg_get_triggerdef(oid) as definition
    from pg_trigger where not tgisinternal
    order by 1`,
  views: `
    select viewname as name, definition
    from pg_views where schemaname = 'public'
    order by 1`,
} as const;

describe("migrations match docs/05 §3", () => {
  it.each(Object.keys(catalogQueries) as (keyof typeof catalogQueries)[])(
    "has the same %s",
    async (kind) => {
      const query = catalogQueries[kind];
      const [actual, expected] = await Promise.all([
        migrated.unsafe(query),
        reference.unsafe(query),
      ]);
      expect(expected.length).toBeGreaterThan(0);
      expect([...actual]).toEqual([...expected]);
    },
  );
});

describe("named database objects from docs/05", () => {
  const constraints = [
    "users_owner_has_login",
    "modifier_groups_range",
    "orders_queue_number_iff_paid",
    "orders_paid_states",
    "orders_expired_unpaid",
    "orders_voided_complete",
    "orders_total_matches",
    "orders_counter_has_creator",
    "orders_self_order_has_qr",
    "order_items_line_total_matches",
    "payments_manual_has_confirmer",
    "payments_paid_has_time",
    "refunds_processed_has_time",
    "stock_movements_sign",
    "stock_count_items_reason_required",
    "association_rules_antecedent_size",
    "association_rules_consequent_new",
  ];
  const indexes = [
    "users_email_lower_uq",
    "sessions_user_idx",
    "menu_items_category_idx",
    "modifier_options_group_idx",
    "orders_queue_uq",
    "orders_status_idx",
    "orders_business_date_idx",
    "orders_client_session_idx",
    "orders_expiry_idx",
    "order_items_order_idx",
    "order_items_menu_idx",
    "order_item_modifiers_item_idx",
    "payments_one_live_per_order",
    "payments_provider_ref_uq",
    "payments_order_idx",
    "refunds_order_idx",
    "restocks_ingredient_idx",
    "stock_movements_ingredient_idx",
    "stock_movements_ref_idx",
    "association_rules_active_idx",
    "association_rules_run_idx",
    "recommendation_events_item_idx",
    "recommendation_events_order_idx",
    "audit_logs_entity_idx",
    "audit_logs_created_idx",
  ];
  const triggers = ["audit_logs_append_only", "stock_movements_append_only"];
  const functions = [
    "forbid_mutation",
    "next_queue_number",
    "business_date_of",
  ];
  const views = ["v_menu_item_cost", "v_menu_item_availability", "v_low_stock"];

  it.each(constraints)("constraint %s exists", async (name) => {
    const rows =
      await migrated`select 1 from pg_constraint where conname = ${name}`;
    expect(rows).toHaveLength(1);
  });

  it.each(indexes)("index %s exists", async (name) => {
    const rows =
      await migrated`select 1 from pg_indexes where schemaname = 'public' and indexname = ${name}`;
    expect(rows).toHaveLength(1);
  });

  it.each(triggers)("trigger %s exists", async (name) => {
    const rows =
      await migrated`select 1 from pg_trigger where tgname = ${name} and not tgisinternal`;
    expect(rows).toHaveLength(1);
  });

  it.each(functions)("function %s exists", async (name) => {
    const rows =
      await migrated`select 1 from pg_proc where proname = ${name} and pronamespace = 'public'::regnamespace`;
    expect(rows).toHaveLength(1);
  });

  it.each(views)("view %s exists", async (name) => {
    const rows =
      await migrated`select 1 from pg_views where schemaname = 'public' and viewname = ${name}`;
    expect(rows).toHaveLength(1);
  });
});

describe("append-only ledgers (I8)", () => {
  it("rejects updating or deleting audit_logs", async () => {
    const [row] = await migrated`
      insert into audit_logs (action) values ('test.append_only') returning id`;
    await expect(
      migrated`update audit_logs set reason = 'edited' where id = ${row!.id}`,
    ).rejects.toThrow("audit_logs is append-only");
    await expect(
      migrated`delete from audit_logs where id = ${row!.id}`,
    ).rejects.toThrow("audit_logs is append-only");
  });

  it("rejects updating or deleting stock_movements", async () => {
    const [ingredient] = await migrated`
      insert into ingredients (name, unit) values ('Test beans', 'g') returning id`;
    const [row] = await migrated`
      insert into stock_movements (ingredient_id, type, qty_delta)
      values (${ingredient!.id}, 'opening', 1000) returning id`;
    await expect(
      migrated`update stock_movements set note = 'edited' where id = ${row!.id}`,
    ).rejects.toThrow("stock_movements is append-only");
    await expect(
      migrated`delete from stock_movements where id = ${row!.id}`,
    ).rejects.toThrow("stock_movements is append-only");
  });
});
