-- A successful edition adds evidence to the pool; absence from a later edition is not a deletion.
CREATE TABLE business_leads (
  id text PRIMARY KEY,
  canonical_url text NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  first_article_id text NOT NULL REFERENCES articles(id),
  first_run_id bigint NOT NULL REFERENCES business_radar_runs(id),
  latest_run_id bigint NOT NULL REFERENCES business_radar_runs(id),
  article_ids text[] NOT NULL,
  content jsonb NOT NULL,
  evidence jsonb NOT NULL
);
CREATE INDEX business_leads_updated_idx ON business_leads(updated_at DESC, id);

-- Keep every original article URL and verbatim citation even after a lead is refreshed.
CREATE TABLE business_lead_evidence (
  lead_id text NOT NULL REFERENCES business_leads(id),
  run_id bigint NOT NULL REFERENCES business_radar_runs(id),
  article_ids text[] NOT NULL,
  observed_at timestamptz NOT NULL,
  content jsonb NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY (lead_id, run_id)
);

-- Worker-only, bounded and idempotent backfill; no model call occurs during reads.
CREATE TABLE business_lead_backfills (
  run_id bigint PRIMARY KEY REFERENCES business_radar_runs(id),
  checked_at timestamptz NOT NULL DEFAULT now(),
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0
);
