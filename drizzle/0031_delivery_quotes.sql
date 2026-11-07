CREATE TABLE delivery_settings (
 id integer PRIMARY KEY CHECK (id=1),
 mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','distance')),
 minimum_order numeric(12,2) NOT NULL DEFAULT 0 CHECK (minimum_order>=0),
 minimum_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (minimum_fee>=0),
 price_per_km numeric(12,2) NOT NULL DEFAULT 0 CHECK (price_per_km>=0),
 origin_address text NOT NULL DEFAULT '',
 origin_lat double precision CHECK (origin_lat BETWEEN -90 AND 90),
 origin_lng double precision CHECK (origin_lng BETWEEN -180 AND 180),
 browser_key text NOT NULL DEFAULT '',
 server_key text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO delivery_settings(id) VALUES(1);
--> statement-breakpoint
CREATE TABLE delivery_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
 address text NOT NULL,
 lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
 lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
 distance_meters integer NOT NULL CHECK (distance_meters>0),
 fee numeric(12,2) NOT NULL CHECK (fee>=0),
 settings_revision integer NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX delivery_quotes_account_idx ON delivery_quotes(account_id,expires_at);
CREATE TABLE delivery_quote_limits(scope text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE sales_orders ADD COLUMN delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK(delivery_fee>=0),
 ADD COLUMN distance_meters integer,
 ADD COLUMN delivery_lat double precision,
 ADD COLUMN delivery_lng double precision,
 ADD COLUMN delivery_pricing text NOT NULL DEFAULT 'manual' CHECK(delivery_pricing IN ('manual','distance'));
ALTER TABLE sales ADD COLUMN delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK(delivery_fee>=0);
