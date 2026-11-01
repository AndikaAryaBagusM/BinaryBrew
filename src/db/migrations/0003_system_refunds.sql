ALTER TABLE "refunds" ALTER COLUMN "requested_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "approved_by" DROP NOT NULL;--> statement-breakpoint
-- A refund is processed only after an owner approved it (BR-07).
ALTER TABLE refunds ADD CONSTRAINT refunds_processed_has_approver check (status <> 'processed' or approved_by is not null);
