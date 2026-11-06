ALTER TABLE products ADD COLUMN IF NOT EXISTS public_code text;
--> statement-breakpoint
DO $$
DECLARE
  product_row record;
  candidate text;
  attempts int;
BEGIN
  FOR product_row IN SELECT id FROM products WHERE public_code IS NULL OR btrim(public_code) = '' LOOP
    attempts := 0;
    LOOP
      candidate := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM products WHERE public_code = candidate);
      attempts := attempts + 1;
      IF attempts > 30 THEN
        RAISE EXCEPTION 'public code generation failed';
      END IF;
    END LOOP;
    UPDATE products SET public_code = candidate WHERE id = product_row.id;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS products_public_code_key ON products (public_code);
--> statement-breakpoint
ALTER TABLE products ALTER COLUMN public_code SET NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_product_public_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
  attempts int := 0;
BEGIN
  IF NEW.public_code IS NOT NULL AND btrim(NEW.public_code) <> '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(672025);
  LOOP
    candidate := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM products WHERE public_code = candidate);
    attempts := attempts + 1;
    IF attempts > 30 THEN
      RAISE EXCEPTION 'public code generation failed';
    END IF;
  END LOOP;
  NEW.public_code := candidate;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS products_public_code ON products;
--> statement-breakpoint
CREATE TRIGGER products_public_code
BEFORE INSERT ON products
FOR EACH ROW
EXECUTE FUNCTION assign_product_public_code();
