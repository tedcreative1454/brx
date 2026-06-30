ALTER TABLE deposits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS broadcast_attempts INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  note TEXT,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute_created ON dispute_evidence(dispute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_broadcast_queue ON withdrawals(status, broadcast_at, confirmed_at);

