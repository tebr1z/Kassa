CREATE TABLE desktop_support_inbox (
 store_url text NOT NULL,
 remote_id uuid NOT NULL,
 payload jsonb NOT NULL,
 message_version text,
 message_cursor text,
 received_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_url,remote_id)
);
--> statement-breakpoint
CREATE TABLE desktop_support_messages (
 store_url text NOT NULL,
 remote_id uuid NOT NULL,
 ticket_id uuid NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(store_url,remote_id),
 FOREIGN KEY(store_url,ticket_id) REFERENCES desktop_support_inbox(store_url,remote_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX desktop_support_messages_ticket_idx ON desktop_support_messages(store_url,ticket_id);
