ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
--> statement-breakpoint
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS authentication_method text NOT NULL DEFAULT 'pin';
--> statement-breakpoint
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS customer_name_snapshot text;
--> statement-breakpoint
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS customer_phone_snapshot text;
--> statement-breakpoint
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS product_name_snapshot text;
--> statement-breakpoint
DELETE FROM desktop_sync_outbox WHERE payload ? 'stock';
