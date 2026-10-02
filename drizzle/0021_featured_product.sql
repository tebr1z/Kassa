ALTER TABLE storefront_config ADD COLUMN IF NOT EXISTS featured_product_id uuid REFERENCES products(id) ON DELETE SET NULL;
