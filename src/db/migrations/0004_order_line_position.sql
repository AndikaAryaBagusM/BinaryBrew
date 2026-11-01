ALTER TABLE "order_item_modifiers" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;