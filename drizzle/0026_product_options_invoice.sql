CREATE TABLE IF NOT EXISTS product_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label text NOT NULL,
  size text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT '',
  price numeric(14,2),
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_options_price_valid CHECK (price IS NULL OR price > 0),
  CONSTRAINT product_options_label_unique UNIQUE(product_id,label)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_options_product_idx ON product_options(product_id,position);
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS option_id uuid REFERENCES product_options(id);
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS option_snapshot text;
--> statement-breakpoint
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS option_id uuid REFERENCES product_options(id);
--> statement-breakpoint
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS option_snapshot text;
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN IF NOT EXISTS buyer_name text;
