-- BRX PostgreSQL launch schema for ETB/USDT P2P escrow.
-- Amounts use NUMERIC so ledger math stays exact.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE kyc_status AS ENUM ('unsubmitted', 'pending', 'approved', 'rejected');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE balance_type AS ENUM ('available', 'locked', 'pending_deposit', 'pending_withdrawal');
CREATE TYPE offer_side AS ENUM ('buy', 'sell');
CREATE TYPE offer_status AS ENUM ('active', 'paused', 'cancelled', 'filled');
CREATE TYPE trade_status AS ENUM ('opened', 'payment_sent', 'released', 'cancelled', 'disputed', 'expired');
CREATE TYPE tx_status AS ENUM ('detected', 'confirming', 'credited', 'requested', 'approved', 'broadcast', 'confirmed', 'failed', 'rejected');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  username TEXT UNIQUE,
  email_verified_at TIMESTAMPTZ,
  kyc_status kyc_status NOT NULL DEFAULT 'unsubmitted',
  status user_status NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'user',
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kyc_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  id_type TEXT NOT NULL,
  id_number TEXT NOT NULL,
  document_front_url TEXT NOT NULL,
  document_back_url TEXT NOT NULL,
  selfie_url TEXT NOT NULL,
  payment_proof_url TEXT,
  status kyc_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT NOT NULL UNIQUE CHECK (tier IN ('unverified', 'verified', 'merchant')),
  daily_trade_limit_usd NUMERIC(20, 2) NOT NULL CHECK (daily_trade_limit_usd > 0),
  withdrawal_limit_usd NUMERIC(20, 2) NOT NULL CHECK (withdrawal_limit_usd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO account_limits (tier, daily_trade_limit_usd, withdrawal_limit_usd) VALUES
  ('unverified', 1000.00, 1000.00),
  ('verified', 5000.00, 5000.00),
  ('merchant', 100000.00, 100000.00)
ON CONFLICT (tier) DO NOTHING;

CREATE TABLE balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL DEFAULT 'USDT',
  available_balance NUMERIC(28, 8) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  locked_balance NUMERIC(28, 8) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  pending_deposit NUMERIC(28, 8) NOT NULL DEFAULT 0 CHECK (pending_deposit >= 0),
  pending_withdrawal NUMERIC(28, 8) NOT NULL DEFAULT 0 CHECK (pending_withdrawal >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset)
);

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL DEFAULT 'USDT',
  balance_type balance_type NOT NULL,
  amount NUMERIC(28, 8) NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  reason TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL DEFAULT 'USDT',
  network TEXT NOT NULL DEFAULT 'BEP20',
  deposit_address TEXT NOT NULL UNIQUE,
  encrypted_private_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset, network)
);

CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notification_preferences JSONB NOT NULL DEFAULT '{"emailVerification":true,"tradeUpdates":true,"depositAlerts":true,"withdrawalAlerts":true,"marketing":false}',
  trade_preferences JSONB NOT NULL DEFAULT '{"market":"ETB/USDT","preferredPaymentRails":["Telebirr","M-Pesa","CBE Birr"]}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('telebirr', 'mpesa', 'cbe_birr', 'airtel_money', 'bank', 'other')),
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

CREATE TABLE withdrawal_addresses (
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

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip_address INET,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_security_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret TEXT,
  pending_two_factor_secret TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  side offer_side NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDT',
  fiat TEXT NOT NULL DEFAULT 'ETB',
  price NUMERIC(20, 4) NOT NULL CHECK (price > 0),
  available_amount NUMERIC(28, 8) NOT NULL CHECK (available_amount >= 0),
  min_fiat NUMERIC(20, 2) NOT NULL CHECK (min_fiat > 0),
  max_fiat NUMERIC(20, 2) NOT NULL CHECK (max_fiat >= min_fiat),
  payment_methods TEXT[] NOT NULL,
  status offer_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offers(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL DEFAULT 'USDT',
  fiat TEXT NOT NULL DEFAULT 'ETB',
  asset_amount NUMERIC(28, 8) NOT NULL CHECK (asset_amount > 0),
  fiat_amount NUMERIC(20, 2) NOT NULL CHECK (fiat_amount > 0),
  payment_method TEXT,
  status trade_status NOT NULL DEFAULT 'opened',
  payment_sent_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  cancelled_at TIMESTAMPTZ,
  cancelled_reason TEXT,
  disputed_at TIMESTAMPTZ,
  dispute_reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trade_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  block_number BIGINT,
  from_address TEXT,
  to_address TEXT,
  network TEXT NOT NULL DEFAULT 'BEP20',
  asset TEXT NOT NULL DEFAULT 'USDT',
  amount NUMERIC(28, 8) NOT NULL CHECK (amount > 0),
  confirmations INTEGER NOT NULL DEFAULT 0,
  status tx_status NOT NULL DEFAULT 'detected',
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, log_index)
);

CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  withdrawal_address_id UUID REFERENCES withdrawal_addresses(id),
  requested_by_session_id UUID REFERENCES user_sessions(id),
  address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'BEP20',
  asset TEXT NOT NULL DEFAULT 'USDT',
  amount NUMERIC(28, 8) NOT NULL CHECK (amount > 0),
  fee NUMERIC(28, 8) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  status tx_status NOT NULL DEFAULT 'requested',
  risk_decision TEXT NOT NULL DEFAULT 'manual_review',
  review_reason TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  auto_approved_at TIMESTAMPTZ,
  broadcast_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  failed_reason TEXT,
  tx_hash TEXT UNIQUE,
  processing_started_at TIMESTAMPTZ,
  broadcast_attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES trades(id),
  opened_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispute_evidence (
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

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  action_url TEXT,
  idempotency_key TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chain_scan_state (
  name TEXT PRIMARY KEY,
  last_scanned_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_balances_user_asset ON balances(user_id, asset);
CREATE INDEX idx_email_verification_codes_user_active ON email_verification_codes(user_id, expires_at DESC) WHERE consumed_at IS NULL;
CREATE INDEX idx_ledger_entries_user_created ON ledger_entries(user_id, created_at DESC);
CREATE INDEX idx_ledger_entries_reference ON ledger_entries(reference_type, reference_id);
CREATE INDEX idx_wallet_accounts_user_network ON wallet_accounts(user_id, asset, network);
CREATE INDEX idx_payment_methods_user_status ON payment_methods(user_id, status, created_at DESC);
CREATE UNIQUE INDEX idx_payment_methods_one_default ON payment_methods(user_id) WHERE is_default = true AND status = 'active';
CREATE INDEX idx_withdrawal_addresses_user_status ON withdrawal_addresses(user_id, status, created_at DESC);
CREATE UNIQUE INDEX idx_withdrawal_addresses_one_default ON withdrawal_addresses(user_id, network, asset) WHERE is_default = true AND status = 'active';
CREATE INDEX idx_user_sessions_user_active ON user_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX idx_offers_market_status ON offers(fiat, asset, side, status, price);
CREATE INDEX idx_trades_buyer_status ON trades(buyer_id, status, created_at DESC);
CREATE INDEX idx_trades_seller_status ON trades(seller_id, status, created_at DESC);
CREATE INDEX idx_trades_status_expires ON trades(status, expires_at);
CREATE INDEX idx_trade_messages_trade_created ON trade_messages(trade_id, created_at ASC);
CREATE INDEX idx_trade_messages_unread ON trade_messages(trade_id, sender_id, created_at ASC) WHERE read_at IS NULL;
CREATE INDEX idx_deposits_user_status ON deposits(user_id, status, created_at DESC);
CREATE INDEX idx_deposits_tx_log ON deposits(tx_hash, log_index);
CREATE INDEX idx_withdrawals_user_status ON withdrawals(user_id, status, created_at DESC);
CREATE INDEX idx_withdrawals_status_decision ON withdrawals(status, risk_decision, created_at DESC);
CREATE INDEX idx_withdrawals_broadcast_queue ON withdrawals(status, broadcast_at, confirmed_at);
CREATE INDEX idx_users_password_changed_at ON users(password_changed_at);
CREATE INDEX idx_disputes_status_created ON disputes(status, created_at DESC);
CREATE INDEX idx_dispute_evidence_dispute_created ON dispute_evidence(dispute_id, created_at DESC);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE is_read = false;
CREATE INDEX idx_kyc_submissions_user_status ON kyc_submissions(user_id, status, created_at DESC);
CREATE INDEX idx_audit_logs_actor_created ON audit_logs(actor_id, created_at DESC);













