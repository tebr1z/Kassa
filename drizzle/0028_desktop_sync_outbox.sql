CREATE TABLE desktop_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigserial UNIQUE NOT NULL,
  store_url text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
--> statement-breakpoint
CREATE INDEX desktop_sync_outbox_pending_idx ON desktop_sync_outbox(store_url,revision) WHERE acknowledged_at IS NULL;
