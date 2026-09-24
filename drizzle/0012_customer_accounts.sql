CREATE TABLE customer_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL REFERENCES customers(id),
 email text UNIQUE NOT NULL,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE customer_sessions (
 token_hash text PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
--> statement-breakpoint
ALTER TABLE sales_orders ADD COLUMN account_id uuid REFERENCES customer_accounts(id),
 ADD COLUMN fulfillment text NOT NULL DEFAULT 'pickup' CHECK(fulfillment IN ('pickup','delivery')),
 ADD COLUMN delivery_address text NOT NULL DEFAULT '',
 ADD COLUMN delivery_stage text NOT NULL DEFAULT 'received' CHECK(delivery_stage IN ('received','preparing','ready','dispatched','delivered'));
--> statement-breakpoint
CREATE INDEX customer_orders_account_idx ON sales_orders(account_id,created_at);
--> statement-breakpoint
CREATE TABLE customer_auth_attempts (email text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());
