ALTER TABLE storefront_config ADD COLUMN slides_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE storefront_slides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id uuid REFERENCES products(id),
 heading text NOT NULL DEFAULT '',
 badge text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '',
 is_active boolean NOT NULL DEFAULT true,
 position integer NOT NULL DEFAULT 0,
 CHECK (product_id IS NOT NULL OR length(trim(heading)) > 0)
);
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN receipt_store jsonb;
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN product_name_snapshot text;
--> statement-breakpoint
CREATE TABLE customer_order_attempts (
 account_id uuid PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 1,
 window_start timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE staff_auth_attempts (
 user_id uuid PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 1,
 window_start timestamptz NOT NULL DEFAULT now()
);
