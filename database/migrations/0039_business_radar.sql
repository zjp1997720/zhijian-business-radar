-- Generated intelligence and its evidence remain separate from the collected articles.
-- Failed runs never replace the most recent successful snapshot.
CREATE TABLE business_radar_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  error text,
  model text,
  receipt_id bigint REFERENCES receipts(id),
  content jsonb,
  evidence jsonb,
  recommended_keys text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX business_radar_success_idx ON business_radar_runs (id DESC) WHERE status = 'ok';
CREATE INDEX business_radar_history_idx ON business_radar_runs (started_at DESC) WHERE status = 'ok';
