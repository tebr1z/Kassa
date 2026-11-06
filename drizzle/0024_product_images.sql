CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  position integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images (product_id, position);
--> statement-breakpoint
INSERT INTO product_images (product_id, image_url, position)
SELECT p.id, p.image_url, 0
FROM products p
WHERE p.image_url IS NOT NULL AND btrim(p.image_url) <> ''
AND NOT EXISTS (
  SELECT 1 FROM product_images pi WHERE pi.product_id = p.id AND pi.image_url = p.image_url
);
