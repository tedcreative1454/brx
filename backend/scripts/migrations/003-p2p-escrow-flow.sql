ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE trades ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes');
ALTER TABLE trades ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS dispute_reason TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trades_status_expires ON trades(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_disputes_status_created ON disputes(status, created_at DESC);
