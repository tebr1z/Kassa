ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
--> statement-breakpoint
ALTER TABLE sales_orders ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS source text DEFAULT 'pos' NOT NULL;
--> statement-breakpoint
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS request_key uuid UNIQUE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_config (
 id integer PRIMARY KEY CHECK (id=1),
 name text NOT NULL DEFAULT 'BirMarket',
 kind text NOT NULL DEFAULT 'market',
 description text NOT NULL DEFAULT 'Gündəlik ehtiyaclarınız, bir ünvanda.',
 logo text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',
 address text NOT NULL DEFAULT ''
);
--> statement-breakpoint
INSERT INTO storefront_config(id) VALUES(1) ON CONFLICT DO NOTHING;
