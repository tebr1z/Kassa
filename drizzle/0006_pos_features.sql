ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "customer_id" uuid REFERENCES "customers"("id");--> statement-breakpoint
CREATE TABLE "held_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cashier_id" uuid NOT NULL REFERENCES "users"("id"),
  "customer_id" uuid REFERENCES "customers"("id"),
  "items_json" jsonb NOT NULL,
  "discount" numeric(14,2) DEFAULT 0 NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "held_receipts_cashier_idx" ON "held_receipts" ("cashier_id","created_at");
