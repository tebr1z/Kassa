ALTER TABLE delivery_settings
 ADD COLUMN free_distance_km numeric(8,3) NOT NULL DEFAULT 0 CHECK(free_distance_km>=0 AND free_distance_km<=10000),
 ADD COLUMN free_order_from numeric(12,2) CHECK(free_order_from>=0);
--> statement-breakpoint
CREATE TABLE open_geocoding_rate (
 id smallint PRIMARY KEY CHECK(id=1),
 next_request_at timestamptz NOT NULL DEFAULT 'epoch'
);
INSERT INTO open_geocoding_rate(id) VALUES(1);
CREATE TABLE open_geocoding_cache (
 cache_key text PRIMARY KEY,
 response jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX open_geocoding_cache_expires_idx ON open_geocoding_cache(expires_at);
REVOKE ALL ON open_geocoding_rate,open_geocoding_cache FROM PUBLIC;
