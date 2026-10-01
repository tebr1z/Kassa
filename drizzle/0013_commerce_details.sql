ALTER TABLE products ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN specifications text NOT NULL DEFAULT '', ADD COLUMN discount_price numeric(14,2);
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT products_discount_valid CHECK (discount_price IS NULL OR (discount_price > 0 AND discount_price < sale_price));
--> statement-breakpoint
ALTER TABLE storefront_config ADD COLUMN whatsapp text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE commerce_coupons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, percent integer NOT NULL CHECK(percent BETWEEN 1 AND 90), minimum numeric(14,2) NOT NULL DEFAULT 0 CHECK(minimum>=0), expires_at timestamptz NOT NULL, usage_limit integer NOT NULL CHECK(usage_limit>0), used integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true);
--> statement-breakpoint
ALTER TABLE sales_orders ADD COLUMN coupon_code text, ADD COLUMN coupon_discount numeric(14,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE contact_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES customer_accounts(id), name text NOT NULL, message text NOT NULL, is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX contact_messages_account_time ON contact_messages(account_id,created_at);
