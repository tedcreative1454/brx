CREATE TABLE IF NOT EXISTS withdrawal_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'BEP20',
  asset TEXT NOT NULL DEFAULT 'USDT',
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, network, address)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_addresses_one_default
  ON withdrawal_addresses(user_id, network, asset)
  WHERE is_default = true AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_withdrawal_addresses_user_status
  ON withdrawal_addresses(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip_address INET,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON user_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_security_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret TEXT,
  pending_two_factor_secret TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE account_limits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
INSERT INTO account_limits (tier, daily_trade_limit_usd, withdrawal_limit_usd) VALUES
  ('unverified', 1000.00, 1000.00),
  ('verified', 5000.00, 5000.00),
  ('merchant', 100000.00, 100000.00)
ON CONFLICT (tier) DO NOTHING;
