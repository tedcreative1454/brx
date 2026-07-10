CREATE TABLE IF NOT EXISTS wallet_sweeps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_account_id UUID NOT NULL REFERENCES wallet_accounts(id),
  user_id UUID NOT NULL REFERENCES users(id),
  deposit_id UUID REFERENCES deposits(id),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDT',
  amount NUMERIC(28, 8) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'gas_funded', 'broadcast', 'confirmed', 'failed', 'skipped')),
  gas_needed_bnb NUMERIC(28, 18),
  gas_funded_bnb NUMERIC(28, 18),
  gas_funding_tx_hash TEXT,
  sweep_tx_hash TEXT UNIQUE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_sweeps_wallet_status ON wallet_sweeps(wallet_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_sweeps_created_at ON wallet_sweeps(created_at DESC);
