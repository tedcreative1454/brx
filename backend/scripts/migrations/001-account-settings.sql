CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notification_preferences JSONB NOT NULL DEFAULT '{"emailVerification":true,"tradeUpdates":true,"depositAlerts":true,"withdrawalAlerts":true,"marketing":false}',
  trade_preferences JSONB NOT NULL DEFAULT '{"market":"ETB/USDT","preferredPaymentRails":["M-Pesa","Bank transfer","Airtel Money"]}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mpesa', 'airtel_money', 'bank', 'other')),
  label TEXT NOT NULL,
  account_name TEXT NOT NULL,
  phone_number TEXT,
  bank_name TEXT,
  account_number TEXT,
  instructions TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user_status ON payment_methods(user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_one_default ON payment_methods(user_id) WHERE is_default = true AND status = 'active';
