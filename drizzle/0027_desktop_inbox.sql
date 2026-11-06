CREATE TABLE desktop_order_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_url text NOT NULL,
  remote_id uuid NOT NULL,
  payload jsonb NOT NULL,
  local_order_id uuid REFERENCES sales_orders(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_url, remote_id)
);
--> statement-breakpoint
CREATE INDEX desktop_order_inbox_updated_idx ON desktop_order_inbox(updated_at DESC);
