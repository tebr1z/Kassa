CREATE TABLE "finance_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('income','expense')),
  "category" text NOT NULL,
  "description" text NOT NULL,
  "account" text DEFAULT 'cash' NOT NULL CHECK ("account" IN ('cash','bank')),
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "supplier_id" uuid REFERENCES "suppliers"("id"),
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id"),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "supplier_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id"),
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "account" text DEFAULT 'bank' NOT NULL CHECK ("account" IN ('cash','bank')),
  "note" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "paid_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "finance_transactions_occurred_idx" ON "finance_transactions" ("occurred_at");--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier_idx" ON "supplier_payments" ("supplier_id","paid_at");
