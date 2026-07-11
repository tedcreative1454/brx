CREATE TABLE IF NOT EXISTS platform_fee_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_type TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDT',
  amount NUMERIC(28, 8) NOT NULL CHECK (amount > 0),
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_fee_entries_created_at
  ON platform_fee_entries(created_at DESC);

INSERT INTO platform_settings (key, value, updated_by, updated_at)
VALUES ('withdrawal_fee_usdt', '1'::jsonb, NULL, now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_by = NULL,
    updated_at = now()
WHERE platform_settings.value = '0'::jsonb
  AND platform_settings.updated_by IS NULL;