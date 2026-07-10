CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value)
VALUES
  ('withdrawal_fee_usdt', '0'::jsonb),
  ('enabled_payment_method_types', '["telebirr","mpesa","cbe_birr","cbe_bank","bank_of_abyssinia","awash_bank"]'::jsonb)
ON CONFLICT (key) DO NOTHING;
