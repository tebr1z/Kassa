ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_lat double precision;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_lng double precision;
