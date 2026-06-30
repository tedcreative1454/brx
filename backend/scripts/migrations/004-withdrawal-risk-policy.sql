ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'confirmed';

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS withdrawal_address_id UUID REFERENCES withdrawal_addresses(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS requested_by_session_id UUID REFERENCES user_sessions(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS risk_decision TEXT NOT NULL DEFAULT 'manual_review';
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS auto_approved_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS broadcast_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS failed_reason TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_users_password_changed_at ON users(password_changed_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_decision ON withdrawals(status, risk_decision, created_at DESC);
