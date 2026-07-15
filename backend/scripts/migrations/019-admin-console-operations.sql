ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_status_created_at ON users(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_kyc_created_at ON users(kyc_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_created_at ON deposits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at ON audit_logs(action, created_at DESC);
