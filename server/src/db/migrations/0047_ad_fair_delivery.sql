BEGIN;
-- Deliberately no opt-in of previously paid campaigns. New writes explicitly select fair_v1.
ALTER TABLE ad_purchases ADD COLUMN delivery_policy TEXT NOT NULL DEFAULT 'legacy'
  CHECK (delivery_policy IN ('legacy', 'fair_v1'));
ALTER TABLE ad_purchases ADD COLUMN compensated_seconds INT NOT NULL DEFAULT 0 CHECK (compensated_seconds >= 0);

CREATE TABLE ad_delivery_stats (
  purchase_id BIGINT NOT NULL REFERENCES ad_purchases(id) ON DELETE CASCADE,
  placement TEXT NOT NULL CHECK (placement IN ('hero_trailer', 'hot_events')),
  turns BIGINT NOT NULL DEFAULT 0,
  eligible BOOLEAN NOT NULL DEFAULT false,
  last_selected_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  plays BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (purchase_id, placement)
);
CREATE TABLE ad_deliveries (
  token UUID PRIMARY KEY,
  purchase_id BIGINT NOT NULL,
  placement TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  batch_key BIGINT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (purchase_id, placement) REFERENCES ad_delivery_stats(purchase_id, placement) ON DELETE CASCADE
);
CREATE INDEX ad_deliveries_visitor_batch ON ad_deliveries(visitor_hash, batch_key);
CREATE INDEX ad_deliveries_expiry ON ad_deliveries(expires_at);
-- One metric per anonymous visitor / campaign / placement / half-hour, even after a reload.
CREATE TABLE ad_observations (
  visitor_hash TEXT NOT NULL,
  purchase_id BIGINT NOT NULL,
  placement TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  impression BOOLEAN NOT NULL DEFAULT false,
  click BOOLEAN NOT NULL DEFAULT false,
  play BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_hash, purchase_id, placement, bucket),
  FOREIGN KEY (purchase_id, placement) REFERENCES ad_delivery_stats(purchase_id, placement) ON DELETE CASCADE
);
CREATE INDEX ad_observations_expiry ON ad_observations(created_at);
CREATE TABLE ad_compensations (
  id BIGSERIAL PRIMARY KEY,
  purchase_id BIGINT NOT NULL REFERENCES ad_purchases(id),
  incident_id TEXT NOT NULL,
  outage_start TIMESTAMPTZ NOT NULL,
  outage_end TIMESTAMPTZ NOT NULL,
  seconds INT NOT NULL CHECK (seconds > 0),
  reason TEXT NOT NULL,
  admin_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, incident_id),
  CHECK (outage_end > outage_start),
  EXCLUDE USING gist (purchase_id WITH =, tstzrange(outage_start, outage_end, '[)') WITH &&)
);
COMMIT;
