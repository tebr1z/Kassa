ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sales_order_id" uuid REFERENCES "sales_orders"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_order_sale_idx" ON "sales" ("sales_order_id") WHERE "sales_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT INTO "product_categories" ("name")
SELECT DISTINCT "category" FROM "products"
WHERE "category" IS NOT NULL AND btrim("category") <> ''
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_errors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "message" text NOT NULL,
  "detail" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_errors_created_idx" ON "system_errors" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
