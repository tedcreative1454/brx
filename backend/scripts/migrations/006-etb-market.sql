UPDATE offers
SET fiat = 'ETB'
WHERE fiat = 'KES';

UPDATE trades
SET fiat = 'ETB'
WHERE fiat = 'KES';

UPDATE user_settings
SET trade_preferences = jsonb_set(
  COALESCE(trade_preferences, '{}'::jsonb),
  '{market}',
  '"ETB/USDT"'::jsonb,
  true
)
WHERE trade_preferences->>'market' = 'KES/USDT';

ALTER TABLE user_settings
ALTER COLUMN trade_preferences SET DEFAULT '{"market":"ETB/USDT","preferredPaymentRails":["M-Pesa","Bank transfer","Airtel Money"]}';

ALTER TABLE offers
ALTER COLUMN fiat SET DEFAULT 'ETB';

ALTER TABLE trades
ALTER COLUMN fiat SET DEFAULT 'ETB';
