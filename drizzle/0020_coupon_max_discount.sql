ALTER TABLE commerce_coupons ADD COLUMN IF NOT EXISTS max_discount numeric(14,2) CHECK (max_discount IS NULL OR max_discount > 0);
