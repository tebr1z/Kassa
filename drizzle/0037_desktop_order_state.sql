ALTER TABLE desktop_order_inbox
 ADD COLUMN import_error text NOT NULL DEFAULT '',
 ADD COLUMN sync_conflict text NOT NULL DEFAULT '',
 ADD COLUMN imported_at timestamptz;
--> statement-breakpoint
CREATE INDEX desktop_order_inbox_attention_idx ON desktop_order_inbox(updated_at DESC)
 WHERE local_order_id IS NULL OR import_error<>'' OR sync_conflict<>'';
