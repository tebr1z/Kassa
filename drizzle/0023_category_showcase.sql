ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS show_on_home boolean NOT NULL DEFAULT false;
