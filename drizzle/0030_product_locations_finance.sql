ALTER TABLE product_options ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE product_options ADD COLUMN IF NOT EXISTS cost_price numeric(14,2);
--> statement-breakpoint
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS sales_warehouse_id uuid REFERENCES warehouses(id);
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS payee text;
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS note text;
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS wage_period text;
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS request_key uuid;
--> statement-breakpoint
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS request_fingerprint text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS finance_request_key_unique ON finance_transactions(request_key) WHERE request_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS finance_branch_date_idx ON finance_transactions(branch_id,occurred_at);
--> statement-breakpoint
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS request_key uuid;
--> statement-breakpoint
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS request_fingerprint text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payment_request_key_unique ON supplier_payments(request_key) WHERE request_key IS NOT NULL;
