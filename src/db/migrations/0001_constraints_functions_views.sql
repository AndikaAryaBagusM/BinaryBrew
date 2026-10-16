-- Hand-written part of docs/05 §3: check constraints, partial and expression
-- indexes, functions, triggers and views. Forward-only; never edit after merge.
-- Unnamed column checks in docs/05 use the PostgreSQL default name
-- <table>_<column>_check.

-- 3.2 Access
ALTER TABLE users ADD CONSTRAINT users_failed_pin_attempts_check check (failed_pin_attempts >= 0);
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_owner_has_login check (role <> 'owner' or (email is not null and password_hash is not null));
--> statement-breakpoint
create unique index users_email_lower_uq on users (lower(email)) where email is not null;
--> statement-breakpoint

-- 3.3 Catalog
ALTER TABLE menu_items ADD CONSTRAINT menu_items_price_check check (price >= 0);
--> statement-breakpoint
ALTER TABLE ingredients ADD CONSTRAINT ingredients_unit_check check (unit in ('g', 'ml', 'pcs'));
--> statement-breakpoint
ALTER TABLE ingredients ADD CONSTRAINT ingredients_avg_cost_check check (avg_cost >= 0);
--> statement-breakpoint
ALTER TABLE ingredients ADD CONSTRAINT ingredients_min_stock_qty_check check (min_stock_qty >= 0);
--> statement-breakpoint
ALTER TABLE recipe_items ADD CONSTRAINT recipe_items_qty_check check (qty > 0);
--> statement-breakpoint
ALTER TABLE modifier_groups ADD CONSTRAINT modifier_groups_min_select_check check (min_select >= 0);
--> statement-breakpoint
ALTER TABLE modifier_groups ADD CONSTRAINT modifier_groups_max_select_check check (max_select >= 1);
--> statement-breakpoint
ALTER TABLE modifier_groups ADD CONSTRAINT modifier_groups_range check (max_select >= min_select);
--> statement-breakpoint
ALTER TABLE modifier_option_ingredients ADD CONSTRAINT modifier_option_ingredients_qty_delta_check check (qty_delta <> 0);
--> statement-breakpoint

-- 3.4 Orders and payments
ALTER TABLE orders ADD CONSTRAINT orders_subtotal_check check (subtotal >= 0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_service_charge_bps_check check (service_charge_bps >= 0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_service_charge_check check (service_charge >= 0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_tax_rate_bps_check check (tax_rate_bps >= 0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_tax_amount_check check (tax_amount >= 0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_total_check check (total >= 0);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_queue_number_iff_paid check ((queue_number is null) = (paid_at is null));
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_paid_states check (status in ('awaiting_payment', 'expired') or paid_at is not null);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_expired_unpaid check (status <> 'expired' or paid_at is null);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_voided_complete check (status <> 'voided' or (paid_at is not null and void_reason is not null and voided_by is not null));
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_total_matches check (total = subtotal + service_charge + case when tax_inclusive then 0 else tax_amount end);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_counter_has_creator check (channel <> 'counter' or created_by is not null);
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_self_order_has_qr check (channel <> 'self_order' or qr_token_id is not null);
--> statement-breakpoint
create unique index orders_queue_uq        on orders (business_date, queue_number) where queue_number is not null;
--> statement-breakpoint
create index orders_client_session_idx     on orders (client_session) where status = 'awaiting_payment';
--> statement-breakpoint
create index orders_expiry_idx             on orders (expires_at) where status = 'awaiting_payment';
--> statement-breakpoint

ALTER TABLE order_items ADD CONSTRAINT order_items_unit_price_check check (unit_price >= 0);
--> statement-breakpoint
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_check check (quantity between 1 and 20);
--> statement-breakpoint
ALTER TABLE order_items ADD CONSTRAINT order_items_line_total_check check (line_total >= 0);
--> statement-breakpoint
ALTER TABLE order_items ADD CONSTRAINT order_items_line_total_matches check (line_total = (unit_price + modifiers_total) * quantity);
--> statement-breakpoint

ALTER TABLE payments ADD CONSTRAINT payments_amount_check check (amount > 0);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_manual_has_confirmer check (method <> 'qris_static_manual' or (confirmed_by is not null and manual_reference is not null));
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_paid_has_time check (status not in ('paid', 'refunded') or paid_at is not null);
--> statement-breakpoint
create unique index payments_one_live_per_order on payments (order_id) where status in ('pending', 'paid');
--> statement-breakpoint
create unique index payments_provider_ref_uq    on payments (provider, provider_ref) where provider_ref is not null;
--> statement-breakpoint

ALTER TABLE refunds ADD CONSTRAINT refunds_amount_check check (amount > 0);
--> statement-breakpoint
ALTER TABLE refunds ADD CONSTRAINT refunds_processed_has_time check (status <> 'processed' or processed_at is not null);
--> statement-breakpoint

-- 3.5 Inventory
ALTER TABLE restocks ADD CONSTRAINT restocks_quantity_check check (quantity > 0);
--> statement-breakpoint
ALTER TABLE restocks ADD CONSTRAINT restocks_total_cost_check check (total_cost >= 0);
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_qty_delta_check check (qty_delta <> 0);
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sign check (
    (type in ('opening', 'restock', 'void_return') and qty_delta > 0)
    or (type in ('sale_deduction', 'waste') and qty_delta < 0)
    or type = 'count_adjustment'
  );
--> statement-breakpoint
ALTER TABLE stock_count_items ADD CONSTRAINT stock_count_items_counted_qty_check check (counted_qty >= 0);
--> statement-breakpoint
ALTER TABLE stock_count_items ADD CONSTRAINT stock_count_items_reason_check check (reason in ('waste', 'spillage', 'counting_error', 'staff_use', 'other'));
--> statement-breakpoint
ALTER TABLE stock_count_items ADD CONSTRAINT stock_count_items_reason_required check (counted_qty = system_qty or reason is not null);
--> statement-breakpoint

-- 3.6 Recommendations
ALTER TABLE association_rule_runs ADD CONSTRAINT association_rule_runs_status_check check (status in ('running', 'succeeded', 'failed', 'skipped_insufficient_data'));
--> statement-breakpoint
ALTER TABLE association_rules ADD CONSTRAINT association_rules_antecedent_size check (cardinality(antecedent) between 1 and 2);
--> statement-breakpoint
ALTER TABLE association_rules ADD CONSTRAINT association_rules_consequent_new check (not (consequent_id = any (antecedent)));
--> statement-breakpoint
create index association_rules_active_idx on association_rules using gin (antecedent) where is_active;
--> statement-breakpoint
ALTER TABLE recommendation_events ADD CONSTRAINT recommendation_events_source_check check (source in ('rule', 'promoted'));
--> statement-breakpoint

-- 3.8 Functions, triggers, views (bodies copied verbatim from docs/05)
create function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;
--> statement-breakpoint
create trigger audit_logs_append_only
  before update or delete on audit_logs
  for each row execute function forbid_mutation();
--> statement-breakpoint
create trigger stock_movements_append_only
  before update or delete on stock_movements
  for each row execute function forbid_mutation();
--> statement-breakpoint

-- Concurrency-safe daily queue number (call inside the "mark paid" transaction)
create function next_queue_number(p_date date) returns integer
language sql as $$
  insert into queue_counters (business_date, last_number)
  values (p_date, 1)
  on conflict (business_date) do update set last_number = queue_counters.last_number + 1
  returning last_number;
$$;
--> statement-breakpoint

-- Business day = local time minus cutoff (BR-14)
create function business_date_of(ts timestamptz, cutoff interval default interval '4 hours') returns date
language sql immutable as $$
  select ((ts at time zone 'Asia/Jakarta') - cutoff)::date;
$$;
--> statement-breakpoint

-- HPP per menu item from recipes and weighted-average ingredient cost.
-- has_recipe is false when the item has no recipe lines (HPP unknown, not zero).
create view v_menu_item_cost as
select
  m.id as menu_item_id,
  count(r.ingredient_id) > 0 as has_recipe,
  coalesce(sum(r.qty * i.avg_cost), 0)::numeric(14,2) as hpp
from menu_items m
left join recipe_items r on r.menu_item_id = m.id
left join ingredients i on i.id = r.ingredient_id
group by m.id;
--> statement-breakpoint

-- Availability for one serving of the base item (modifier deltas are checked in the app at checkout)
create view v_menu_item_availability as
select
  m.id as menu_item_id,
  (
    m.is_active
    and not m.manual_sold_out
    and not exists (
      select 1
      from recipe_items r
      join ingredients i on i.id = r.ingredient_id
      where r.menu_item_id = m.id and i.stock_qty < r.qty
    )
  ) as is_available
from menu_items m;
--> statement-breakpoint

create view v_low_stock as
select id as ingredient_id, name, unit, stock_qty, min_stock_qty
from ingredients
where is_active and stock_qty <= min_stock_qty;
